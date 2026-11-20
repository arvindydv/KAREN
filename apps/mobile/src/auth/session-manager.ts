import type {
  AuthChallengeResponse,
  LoginRequest,
  LoginResponse,
  RefreshRequest,
  RefreshResponse,
} from '@karen/api-contracts';
import { ApiRequestError } from '../lib/api-error';
import { SESSION_KEYS, type SecureCredentialStore } from '../lib/secure-storage';

/**
 * Mobile session manager (pure TS — no React, no Expo imports; dependencies are injected).
 *
 * - Refresh token: SecureStore ONLY (read when needed, never cached in memory).
 * - Access token: memory + SecureStore (so a relaunch can reuse a still-valid token).
 * - Refresh is SINGLE-FLIGHT: concurrent 401s / expiries share one in-flight call. Refresh
 *   tokens are single use; a second concurrent call with the same token would revoke the session.
 * - A definitive refresh rejection (401/400/403) clears local secrets → signed_out.
 *   A network/5xx/429 failure keeps the session and surfaces `refreshProblem: 'network'`.
 * - Logout always clears local secrets, even when the server call fails.
 * Nothing here logs tokens or passwords.
 */

export type SessionStatus = 'unknown' | 'signed_out' | 'signed_in';
export type AccountStatus = 'ACTIVE' | 'DELETION_REQUESTED';

export interface SessionSnapshot {
  status: SessionStatus;
  accountStatus: AccountStatus | null;
  /** Set when the last refresh failed for a transient reason; the session is kept. */
  refreshProblem: 'network' | null;
}

export interface AuthTransport {
  login(body: LoginRequest): Promise<LoginResponse>;
  refresh(body: RefreshRequest): Promise<RefreshResponse>;
  /** Server-side sign-out of this session (`all` → every session). */
  logout(accessToken: string, all: boolean): Promise<void>;
}

export interface SessionManagerDeps {
  store: SecureCredentialStore;
  transport: AuthTransport;
  platform: 'ios' | 'android';
  newUuid: () => string;
  deviceName?: string;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Error sink (crash reporter). Must not receive tokens — we only pass Error objects. */
  onError?: (error: unknown, context: Record<string, string>) => void;
}

export type LoginResult =
  | { kind: 'signed_in'; accountStatus: AccountStatus }
  | { kind: 'verification_required'; challenge: AuthChallengeResponse };

export type RefreshOutcome = 'refreshed' | 'signed_out' | 'transient_failure';

/** Treat the access token as expired this long before its real expiry (clock skew). */
export const ACCESS_TOKEN_SKEW_MS = 30_000;
/** Proactively refresh this long before access-token expiry. */
export const PROACTIVE_REFRESH_LEAD_MS = 60_000;
/** After a transient refresh failure, try again automatically after this delay. */
export const TRANSIENT_RETRY_MS = 30_000;

const isTerminalRefreshError = (err: unknown): boolean =>
  err instanceof ApiRequestError &&
  (err.status === 401 || err.status === 400 || err.status === 403);

export class SessionManager {
  private snapshot: SessionSnapshot = {
    status: 'unknown',
    accountStatus: null,
    refreshProblem: null,
  };
  private readonly listeners = new Set<(s: SessionSnapshot) => void>();
  private accessToken: string | null = null;
  private accessExpiresAt: number | null = null;
  private refreshing: Promise<RefreshOutcome> | null = null;
  private installationId: Promise<string> | null = null;
  private timer: unknown = null;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly deps: SessionManagerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  // ── observable state ────────────────────────────────────────────────────────────────
  getSnapshot = (): SessionSnapshot => this.snapshot;

  subscribe = (listener: (s: SessionSnapshot) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setSnapshot(patch: Partial<SessionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l(this.snapshot);
  }

  // ── installation id ─────────────────────────────────────────────────────────────────
  /** Per-install UUID, generated once and persisted in the secure store. */
  getInstallationId(): Promise<string> {
    this.installationId ??= (async () => {
      const existing = await this.deps.store.get('karen.device.installation_id');
      if (existing) return existing;
      const id = this.deps.newUuid();
      await this.deps.store.set('karen.device.installation_id', id);
      return id;
    })().catch((err: unknown) => {
      this.installationId = null; // allow a later retry
      throw err;
    });
    return this.installationId;
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────────────
  /** Restore a session on app launch. Resolves once the status is known. */
  async restore(): Promise<SessionSnapshot> {
    const refreshToken = await this.deps.store.get('karen.auth.refresh_token');
    if (!refreshToken) {
      await this.clearLocal();
      return this.snapshot;
    }
    const [access, expiresAt, account] = await Promise.all([
      this.deps.store.get('karen.auth.access_token'),
      this.deps.store.get('karen.auth.access_token_expires_at'),
      this.deps.store.get('karen.auth.account_status'),
    ]);
    this.accessToken = access;
    this.accessExpiresAt = expiresAt ? Date.parse(expiresAt) : null;
    const accountStatus: AccountStatus =
      account === 'DELETION_REQUESTED' ? 'DELETION_REQUESTED' : 'ACTIVE';
    if (this.accessTokenUsable()) {
      this.setSnapshot({ status: 'signed_in', accountStatus, refreshProblem: null });
      this.scheduleProactiveRefresh();
      return this.snapshot;
    }
    // Access token missing/expired: refresh before declaring the session usable.
    this.snapshot = { ...this.snapshot, accountStatus };
    const outcome = await this.refresh();
    if (outcome === 'transient_failure') this.setSnapshot({ status: 'signed_in' });
    return this.snapshot;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const installationId = await this.getInstallationId();
    const res = await this.deps.transport.login({
      email,
      password,
      client: this.deps.platform,
      device: {
        installation_id: installationId,
        ...(this.deps.deviceName ? { name: this.deps.deviceName } : {}),
      },
    });
    if (res.result === 'verification_required') {
      return { kind: 'verification_required', challenge: res.challenge };
    }
    if (!res.access_token || !res.refresh_token || !res.access_token_expires_at) {
      throw new Error('Sign-in response is missing mobile credentials');
    }
    await this.persistTokens(res.refresh_token, res.access_token, res.access_token_expires_at);
    await this.deps.store.set('karen.auth.account_status', res.account_status);
    this.setSnapshot({
      status: 'signed_in',
      accountStatus: res.account_status,
      refreshProblem: null,
    });
    this.scheduleProactiveRefresh();
    return { kind: 'signed_in', accountStatus: res.account_status };
  }

  /**
   * Sign out. The server call is best-effort; local secrets are ALWAYS cleared so a failed
   * network call can never leave a usable session on the device.
   */
  async logout(options: { all?: boolean } = {}): Promise<void> {
    const token = this.accessToken;
    try {
      if (token) await this.deps.transport.logout(token, options.all ?? false);
    } catch (err) {
      this.deps.onError?.(err, { op: 'logout' });
    } finally {
      await this.clearLocal();
    }
  }

  /**
   * End the session locally without a server call — e.g. after the server revoked every
   * session (account deletion request, password reset elsewhere).
   */
  async endSessionLocally(): Promise<void> {
    await this.clearLocal();
  }

  async setAccountStatus(accountStatus: AccountStatus): Promise<void> {
    if (this.snapshot.status !== 'signed_in') return;
    await this.deps.store.set('karen.auth.account_status', accountStatus);
    this.setSnapshot({ accountStatus });
  }

  // ── tokens ──────────────────────────────────────────────────────────────────────────
  /** Current access token, refreshing first if it is missing or about to expire. */
  async getAccessToken(): Promise<string | undefined> {
    if (this.snapshot.status === 'signed_out') return undefined;
    if (this.accessTokenUsable()) return this.accessToken ?? undefined;
    const outcome = await this.refresh();
    if (outcome === 'signed_out') return undefined;
    // On a transient failure keep sending what we have; the server decides.
    return this.accessToken ?? undefined;
  }

  /**
   * Called when a request made with `usedToken` got 401. If another caller already rotated
   * the token, reuse the new one; otherwise join/start the single refresh.
   */
  async handleUnauthorized(usedToken: string | undefined): Promise<string | undefined> {
    if (this.accessToken && usedToken !== this.accessToken && this.accessTokenUsable()) {
      return this.accessToken;
    }
    const outcome = await this.refresh();
    return outcome === 'refreshed' ? (this.accessToken ?? undefined) : undefined;
  }

  /** Single-flight refresh: every concurrent caller awaits the same promise. */
  refresh(): Promise<RefreshOutcome> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** App returned to the foreground: refresh if the access token is close to expiry. */
  async onForeground(): Promise<void> {
    if (this.snapshot.status !== 'signed_in') return;
    if (this.expiresWithin(PROACTIVE_REFRESH_LEAD_MS)) await this.refresh();
  }

  dispose(): void {
    this.cancelTimer();
    this.listeners.clear();
  }

  // ── internals ───────────────────────────────────────────────────────────────────────
  private async doRefresh(): Promise<RefreshOutcome> {
    const refreshToken = await this.deps.store.get('karen.auth.refresh_token');
    if (!refreshToken) {
      await this.clearLocal();
      return 'signed_out';
    }
    let res: RefreshResponse;
    try {
      const installationId = await this.getInstallationId();
      res = await this.deps.transport.refresh({
        refresh_token: refreshToken,
        installation_id: installationId,
      });
    } catch (err) {
      if (isTerminalRefreshError(err)) {
        await this.clearLocal();
        return 'signed_out';
      }
      this.deps.onError?.(err, { op: 'refresh' });
      this.setSnapshot({ refreshProblem: 'network' });
      this.scheduleIn(TRANSIENT_RETRY_MS);
      return 'transient_failure';
    }
    try {
      await this.persistTokens(res.refresh_token, res.access_token, res.access_token_expires_at);
    } catch (err) {
      // The server already rotated. Retrying with the old token within its 10 s grace window
      // returns this same successor, so this is recoverable — keep the session.
      this.deps.onError?.(err, { op: 'persist_tokens' });
      this.accessToken = res.access_token;
      this.accessExpiresAt = Date.parse(res.access_token_expires_at);
      this.setSnapshot({ refreshProblem: 'network' });
      return 'transient_failure';
    }
    if (this.snapshot.status !== 'signed_in' || this.snapshot.refreshProblem) {
      this.setSnapshot({ status: 'signed_in', refreshProblem: null });
    }
    this.scheduleProactiveRefresh();
    return 'refreshed';
  }

  /** Writes the (single-use) refresh token FIRST, then the access token. */
  private async persistTokens(refresh: string, access: string, expiresAt: string): Promise<void> {
    await this.deps.store.set('karen.auth.refresh_token', refresh);
    await this.deps.store.set('karen.auth.access_token', access);
    await this.deps.store.set('karen.auth.access_token_expires_at', expiresAt);
    this.accessToken = access;
    this.accessExpiresAt = Date.parse(expiresAt);
  }

  private async clearLocal(): Promise<void> {
    this.cancelTimer();
    this.accessToken = null;
    this.accessExpiresAt = null;
    const results = await Promise.allSettled(SESSION_KEYS.map((k) => this.deps.store.remove(k)));
    for (const r of results) {
      if (r.status === 'rejected') this.deps.onError?.(r.reason, { op: 'clear_secure_store' });
    }
    this.setSnapshot({ status: 'signed_out', accountStatus: null, refreshProblem: null });
  }

  private accessTokenUsable(): boolean {
    return this.accessToken !== null && !this.expiresWithin(ACCESS_TOKEN_SKEW_MS);
  }

  private expiresWithin(ms: number): boolean {
    return this.accessExpiresAt === null || this.accessExpiresAt - this.now() <= ms;
  }

  private scheduleProactiveRefresh(): void {
    if (this.accessExpiresAt === null) return;
    this.scheduleIn(Math.max(this.accessExpiresAt - this.now() - PROACTIVE_REFRESH_LEAD_MS, 1_000));
  }

  private scheduleIn(ms: number): void {
    this.cancelTimer();
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.refresh();
    }, ms);
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }
}

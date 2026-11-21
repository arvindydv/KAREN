// Phase 01 / M10 — authentication performance benchmark (reproducible; NOT a CI test).
//
//   pnpm --filter @karen/api build
//   node --env-file=.env scripts/bench-auth.mjs [users=20] [requests=400] [concurrency=16]
//
// Boots the BUILT API in-process on a random local port against the local PostgreSQL/Redis
// (`pnpm infra:up`), with e-mail captured in memory (nothing is sent) and generous rate limits
// so the limiter does not dominate. Creates verified test accounts through the real HTTP flow,
// then measures over HTTP:
//   login (Argon2id verify + session), session validation (GET /v1/me with an access token),
//   token refresh (rotation), profile read, consent check (in-process ConsentService call).
// Prints p50/p95/p99, throughput and process RSS/CPU. Record results with the environment in
// docs/security/auth-performance-benchmark.md — never invent numbers.
import { randomUUID } from 'node:crypto';
import { cpus, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';

const USERS = Number(process.argv[2] ?? 20);
const REQUESTS = Number(process.argv[3] ?? 400);
const CONCURRENCY = Number(process.argv[4] ?? 16);
const PW = 'benchmark passphrase granite harbour';

process.env.EMAIL_TRANSPORT = 'memory';
process.env.LOG_LEVEL = 'error';
process.env.API_RATE_LIMIT_PER_MINUTE = '10000';
process.env.API_SENSITIVE_RATE_LIMIT_PER_MINUTE = '1000';
process.env.EMAIL_SEND_LIMIT_PER_HOUR = '100';
process.env.LOGIN_MAX_FAILURES = '100';
process.env.STAFF_AUTH_ENABLED = 'false';

const { createApp } = await import('../dist/bootstrap.js');
const { loadApiEnv } = await import('../dist/config/env.js');
const { MAIL_TRANSPORT, MailService } = await import('../dist/infrastructure/mail/mail.service.js');
const { ConsentService } = await import('../dist/consent/consent.service.js');

const app = await createApp(loadApiEnv(), { logger: false });
await app.listen({ port: 0, host: '127.0.0.1' });
const base = await app.getUrl();
const mail = app.get(MAIL_TRANSPORT);
// Like the load balancer: start only once Redis (fail-closed limiters) is ready.
for (let i = 0; i < 50 && !(await fetch(`${base}/health/ready`)).ok; i++) {
  await new Promise((r) => setTimeout(r, 100));
}

const post = (path, body, headers = {}) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const get = (path, token) =>
  fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });

// ── setup: verified accounts through the real flow ─────────────────────────────────────────
const run = Date.now().toString(36);
const accounts = [];
for (let i = 0; i < USERS; i++) {
  const email = `bench.${run}.${i}@example.test`;
  const reg = await (await post('/v1/auth/register', { email, password: PW })).json();
  await app.get(MailService).drain();
  const code = /\b(\d{6})\b/.exec(mail.to(email).at(-1)?.text ?? '')?.[1];
  const ok = await post('/v1/auth/verify-email', { challenge_handle: reg.challenge_handle, code });
  if (!ok.ok) throw new Error(`verify failed: ${ok.status}`);
  accounts.push({ email, installation: randomUUID() });
}

async function bench(name, total, op) {
  const samples = [];
  let failures = 0;
  let next = 0;
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < total) {
        const i = next++;
        const s = performance.now();
        try {
          const okay = await op(i);
          if (!okay) failures++;
        } catch {
          failures++;
        }
        samples.push(performance.now() - s);
      }
    }),
  );
  const seconds = (performance.now() - t0) / 1000;
  const cpu = process.cpuUsage(cpu0);
  samples.sort((a, b) => a - b);
  const p = (q) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))].toFixed(1);
  process.stdout.write(
    `${name.padEnd(22)} n=${total} c=${CONCURRENCY} p50=${p(0.5)}ms p95=${p(0.95)}ms p99=${p(0.99)}ms ` +
      `rps=${(total / seconds).toFixed(0)} fail=${failures} cpu=${((cpu.user + cpu.system) / 1e6).toFixed(1)}s ` +
      `rss=${Math.round(process.memoryUsage().rss / 2 ** 20)}MiB\n`,
  );
}

process.stdout.write(
  `node ${process.version} · ${cpus()[0]?.model} · ${cpus().length} CPUs · ${Math.round(totalmem() / 2 ** 30)} GiB · ` +
    `UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE ?? '4 (default)'} · hash gate=${process.env.PASSWORD_HASH_MAX_CONCURRENCY ?? 4}\n`,
);

const logins = [];
const loginCount = Math.min(REQUESTS, 200);
await bench('login (argon2id)', loginCount, async (i) => {
  const a = accounts[i % accounts.length];
  const r = await post('/v1/auth/login', {
    email: a.email,
    password: PW,
    client: 'android',
    device: { installation_id: a.installation },
  });
  if (!r.ok) return false;
  const body = await r.json();
  logins.push({
    access: body.access_token,
    refresh: body.refresh_token,
    installation: a.installation,
    user: body.user_id,
  });
  return true;
});

const sessions = logins.slice(0, accounts.length);
await bench(
  'session validation',
  REQUESTS,
  async (i) => (await get('/v1/me', sessions[i % sessions.length].access)).ok,
);
await bench(
  'profile read',
  REQUESTS,
  async (i) => (await get('/v1/me/profile', sessions[i % sessions.length].access)).ok,
);

const chains = logins.slice(accounts.length, accounts.length * 2).length
  ? logins.slice(accounts.length, accounts.length * 2)
  : logins.slice(0, accounts.length);
const refreshCount = Math.min(REQUESTS, chains.length * 10);
await bench('token refresh', refreshCount, async (i) => {
  const c = chains[i % chains.length];
  // One chain per worker slot at a time is not guaranteed; serialize per chain with a lock.
  while (c.busy) await new Promise((r) => setTimeout(r, 1));
  c.busy = true;
  try {
    const r = await post('/v1/auth/token/refresh', {
      refresh_token: c.refresh,
      installation_id: c.installation,
    });
    if (!r.ok) return false;
    c.refresh = (await r.json()).refresh_token;
    return true;
  } finally {
    c.busy = false;
  }
});

const consent = app.get(ConsentService);
await bench('consent check (svc)', REQUESTS, async (i) => {
  await consent.hasActiveConsent(sessions[i % sessions.length].user, 'AI_PROCESSING');
  return true;
});

await app.close();

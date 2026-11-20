import type { ClientKind, Permission, Role } from '@karen/api-contracts';

/** The authenticated caller, resolved server-side. Never built from client-supplied fields. */
export interface AuthenticatedPrincipal {
  /** Internal user UUID (identity.users.id). */
  userId: string;
  /** Live session this request authenticated with (identity.sessions.id). */
  sessionId: string;
  client: ClientKind;
  /** When the user last proved a credential for this session (re-auth checks). */
  authTime: Date;
  roles: Role[];
  permissions: Permission[];
  /** True for a DELETION_REQUESTED account's restricted session (M7). */
  restricted: boolean;
  /** Pseudonymous reference for logs/traces/AI calls. */
  userRef: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: AuthenticatedPrincipal;
  }
}

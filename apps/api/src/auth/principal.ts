import type { Permission, Role } from '@karen/api-contracts';

/** The authenticated caller, resolved server-side. Never built from client-supplied fields. */
export interface AuthenticatedPrincipal {
  /** Internal user UUID (identity.users.id). */
  userId: string;
  issuer: string;
  subject: string;
  roles: Role[];
  permissions: Permission[];
  /** Pseudonymous reference for logs/traces/AI calls. */
  userRef: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: AuthenticatedPrincipal;
  }
}

import { z } from 'zod';

/** Staff roles (RBAC). End users always have `user`. Permissions are derived server-side. */
export const ROLES = ['user', 'support_agent', 'ops_admin', 'security_admin'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const PERMISSIONS = [
  'self:read',
  'self:write',
  'ops:read',
  'ops:cases:write',
  'audit:read',
  'flags:write',
] as const;
export const permissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof permissionSchema>;

/** Role → permission mapping. Lives in contracts so admin UI can render, but is ENFORCED only by the API. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  user: ['self:read', 'self:write'],
  support_agent: ['self:read', 'self:write', 'ops:read', 'ops:cases:write'],
  ops_admin: ['self:read', 'self:write', 'ops:read', 'ops:cases:write', 'flags:write'],
  security_admin: ['self:read', 'self:write', 'ops:read', 'audit:read'],
};

export const meResponseSchema = z
  .object({
    id: z.uuid(),
    display_name: z.string().nullable(),
    locale: z.string(),
    timezone: z.string(),
    roles: z.array(roleSchema),
    permissions: z.array(permissionSchema),
    created_at: z.iso.datetime(),
  })
  .strict()
  .meta({ id: 'MeResponse' });
export type MeResponse = z.infer<typeof meResponseSchema>;

export const adminSystemStatusSchema = z
  .object({
    environment: z.string(),
    execution_paused: z.boolean(),
    ai_gateway_mode: z.enum(['mock', 'live', 'unknown']),
    generated_at: z.iso.datetime(),
  })
  .strict()
  .meta({ id: 'AdminSystemStatus' });
export type AdminSystemStatus = z.infer<typeof adminSystemStatusSchema>;

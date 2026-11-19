import type { Permission } from '@karen/api-contracts';

export interface NavItem {
  href: string;
  label: string;
  /** Hides the link for staff without the permission. UX only — the API enforces access. */
  requires: Permission;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/system', label: 'System status', requires: 'ops:read' },
  { href: '/cases', label: 'Support cases', requires: 'ops:cases:write' },
  { href: '/audit', label: 'Audit log', requires: 'audit:read' },
  { href: '/flags', label: 'Feature flags', requires: 'flags:write' },
];

export const visibleNav = (permissions: readonly Permission[]): NavItem[] =>
  NAV_ITEMS.filter((item) => permissions.includes(item.requires));

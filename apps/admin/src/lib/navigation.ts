import type { StaffPermission } from '@karen/api-contracts';

export interface NavItem {
  href: string;
  label: string;
  /**
   * Hides the link for staff without the permission. DISPLAY ONLY — pages never consult this;
   * the API authorises every call (and the pages render its 403 as a denied state).
   */
  requires: StaffPermission | null;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/account', label: 'My account', requires: null },
  { href: '/system', label: 'System status', requires: 'ops:read' },
  { href: '/elevations', label: 'Elevations', requires: null },
  { href: '/invitations', label: 'Invitations', requires: 'staff:manage' },
  { href: '/staff', label: 'Staff accounts', requires: 'staff:manage' },
  { href: '/users', label: 'User status lookup', requires: 'users:read_status' },
];

export const visibleNav = (permissions: readonly string[]): NavItem[] =>
  NAV_ITEMS.filter((item) => item.requires === null || permissions.includes(item.requires));

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@karen/ui/web';
import { SignOutButton } from './sign-out-button';

const links = [
  { href: '/app', label: 'Home' },
  { href: '/app/chat', label: 'Chat' },
  { href: '/app/settings/profile', label: 'Profile' },
  { href: '/app/settings/preferences', label: 'Preferences' },
  { href: '/app/settings/security', label: 'Security' },
  { href: '/app/settings/privacy', label: 'Privacy & data' },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Account" className="flex flex-wrap items-center justify-between gap-3">
      <ul className="flex flex-wrap gap-1 text-sm">
        {links.map((l) => {
          const active =
            l.href === '/app'
              ? pathname === l.href
              : pathname === l.href || pathname.startsWith(`${l.href}/`);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'landing-nav-link rounded-full px-3 py-2',
                  active && 'bg-surface font-medium text-foreground',
                )}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <SignOutButton variant="ghost" />
    </nav>
  );
}

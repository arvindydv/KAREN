import Link from 'next/link';
import { ThemeToggle } from './theme-toggle';

const links = [
  { href: '/#features', label: 'Features' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#trust', label: 'Trust' },
];

/**
 * Floating glass pill header. The wrapper has zero height so the header overlays the page
 * (no seam above the hero); pages reserve top space themselves. A 3-column grid with equal
 * outer columns keeps the links exactly centred regardless of what sits left/right.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 h-0">
      <div className="px-4 pt-4">
        <nav
          aria-label="Primary"
          className="landing-header mx-auto flex h-16 max-w-6xl items-center justify-between rounded-full px-3 md:grid md:grid-cols-[1fr_auto_1fr]"
        >
          <Link
            href="/"
            className="flex items-center gap-2.5 justify-self-start rounded-full py-1 pr-3 pl-1 text-[17px] font-semibold tracking-tight"
          >
            <span
              className="landing-gradient-bg grid size-10 place-items-center rounded-full text-sm font-bold text-white shadow-[0_6px_18px_-6px_rgb(37_99_235/0.8)]"
              aria-hidden="true"
            >
              K
            </span>
            KAREN
          </Link>
          <ul className="hidden items-center gap-1 text-sm md:flex">
            {links.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="landing-nav-link rounded-full px-4 py-2">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 justify-self-end">
            <ThemeToggle />
            <Link href="/app" className="landing-btn-primary h-10 !px-5 !py-0 text-sm">
              Open app
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}

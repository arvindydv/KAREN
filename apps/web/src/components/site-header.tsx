import Link from 'next/link';
import { ThemeToggle } from './theme-toggle';

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <nav
        aria-label="Primary"
        className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4"
      >
        <Link href="/" className="text-lg font-semibold tracking-tight">
          KAREN
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/app" className="rounded-md px-3 py-2 text-sm hover:bg-surface">
            Open app
          </Link>
          <ThemeToggle />
        </div>
      </nav>
    </header>
  );
}

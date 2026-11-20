import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'KAREN Operations', template: '%s · KAREN Ops' },
  robots: { index: false, follow: false },
};

/**
 * Every page renders per request so Next.js can apply the per-request CSP nonce from
 * `src/proxy.ts` (statically prerendered HTML would carry no nonce and be blocked).
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

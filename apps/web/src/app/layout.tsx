import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/site-header';
import { themeInitScript } from '@/components/theme-toggle';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'KAREN — Your life. Understood. Taken care of.', template: '%s · KAREN' },
  description:
    'KAREN is a permission-based personal AI life agent: it remembers what you share, helps you decide, and follows through on approved tasks.',
  applicationName: 'KAREN',
  robots: { index: false, follow: false }, // pre-launch: do not index
  openGraph: {
    title: 'KAREN',
    description: 'Your life. Understood. Taken care of.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F3F5FB' },
    { media: '(prefers-color-scheme: dark)', color: '#0A0F24' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Per-request CSP nonce from src/proxy.ts (Next applies it to its own scripts automatically).
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:p-2">
          Skip to content
        </a>
        <Providers>
          <SiteHeader />
          {/* Pages own their width: the landing page is full-bleed, app pages use <PageContainer>. */}
          <main id="main">{children}</main>
        </Providers>
      </body>
    </html>
  );
}

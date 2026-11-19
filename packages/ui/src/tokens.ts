/**
 * KAREN design tokens — the single source for colour, type, spacing and radius across
 * web, admin (via generated CSS variables) and mobile (imported directly as numbers/strings).
 * Platform-neutral: no DOM or React Native imports here.
 *
 * Visual direction (product spec §26.1): calm, premium, low clutter, restrained accent,
 * accessible contrast. Colour pairs are chosen for WCAG AA text contrast on their surface.
 */

export const palette = {
  ink950: '#0B0D12',
  ink900: '#12151C',
  ink800: '#1B1F29',
  ink700: '#2A2F3B',
  ink500: '#5B6272',
  ink400: '#8A90A0',
  ink200: '#D5D8E0',
  ink100: '#ECEEF2',
  ink50: '#F7F8FA',
  white: '#FFFFFF',
  saffron500: '#E0772E',
  saffron600: '#AD5217',
  saffron300: '#F2A66B',
  teal600: '#0F766E',
  teal400: '#2DB3A6',
  red600: '#C53030',
  red400: '#F07171',
  amber600: '#B7791F',
  amber400: '#F2C14E',
} as const;

export interface ColorScheme {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  accentText: string;
  success: string;
  warning: string;
  danger: string;
  focusRing: string;
}

export const colors: Readonly<Record<'light' | 'dark', ColorScheme>> = {
  light: {
    background: palette.ink50,
    surface: palette.white,
    surfaceRaised: palette.white,
    border: palette.ink200,
    textPrimary: palette.ink950,
    textSecondary: palette.ink500,
    accent: palette.saffron600,
    accentText: palette.white,
    success: palette.teal600,
    warning: palette.amber600,
    danger: palette.red600,
    focusRing: palette.saffron500,
  },
  dark: {
    background: palette.ink950,
    surface: palette.ink900,
    surfaceRaised: palette.ink800,
    border: palette.ink700,
    textPrimary: palette.ink50,
    textSecondary: palette.ink400,
    accent: palette.saffron300,
    accentText: palette.ink950,
    success: palette.teal400,
    warning: palette.amber400,
    danger: palette.red400,
    focusRing: palette.saffron300,
  },
};

/** 4-pt spacing scale (px / dp). */
export const spacing = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const typography = {
  fontFamily: {
    sans: 'Inter, "Noto Sans", "Noto Sans Devanagari", system-ui, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, monospace',
  },
  /** Size / line-height pairs. Devanagari needs generous line-height. */
  scale: {
    caption: { size: 12, lineHeight: 18 },
    body: { size: 16, lineHeight: 24 },
    bodyLarge: { size: 18, lineHeight: 28 },
    title: { size: 22, lineHeight: 30 },
    headline: { size: 30, lineHeight: 38 },
    display: { size: 40, lineHeight: 48 },
  },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
} as const;

/** Minimum touch target (dp/px) — product spec §26.3 large touch targets. */
export const MIN_TOUCH_TARGET = 44;

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

/** CSS custom properties for web/admin; consumed by Tailwind v4 `@theme inline`. */
export function tokensToCss(): string {
  const vars = (scheme: ColorScheme) =>
    Object.entries(scheme)
      .map(([k, v]) => `  --karen-${kebab(k)}: ${v};`)
      .join('\n');
  const radii = Object.entries(radius)
    .map(([k, v]) => `  --karen-radius-${k}: ${v}px;`)
    .join('\n');
  return [
    '/* Generated from @karen/ui tokens.ts — do not edit by hand. */',
    `:root {\n${vars(colors.light)}\n${radii}\n  --karen-font-sans: ${typography.fontFamily.sans};\n  color-scheme: light;\n}`,
    `.dark {\n${vars(colors.dark)}\n  color-scheme: dark;\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root:not(.light) {\n${vars(colors.dark)
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n')}\n    color-scheme: dark;\n  }\n}`,
    '',
  ].join('\n\n');
}

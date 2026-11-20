/**
 * KAREN design tokens — the single source for colour, type, spacing and radius across
 * web, admin (via generated CSS variables) and mobile (imported directly as numbers/strings).
 * Platform-neutral: no DOM or React Native imports here.
 *
 * Visual direction (product spec §26.1): premium "deep space" theme — navy starfield, frosted
 * glass surfaces, one bright blue action colour. Colour pairs are chosen for WCAG AA text
 * contrast on their surfaces (enforced by tokens.test.ts).
 */

export const palette = {
  // Deep-space navy neutrals (dark scheme backbone).
  space950: '#060A1C',
  space900: '#0B1230',
  space850: '#111A3E',
  space800: '#18234F',
  space700: '#27346A',
  space400: '#9AA6CB',
  space300: '#C3CBE6',
  // Light scheme neutrals (cool periwinkle).
  mist50: '#F3F5FD',
  mist100: '#E7EBF8',
  mist200: '#CFD6EE',
  mist500: '#4B5578',
  mist950: '#0A1030',
  white: '#FFFFFF',
  // Brand blue (primary actions).
  blue700: '#1D4ED8',
  blue600: '#2563EB',
  blue400: '#60A5FA',
  blue300: '#93C5FD',
  // Category accents (icon chips, charts).
  green500: '#22C55E',
  green700: '#047857',
  green300: '#4ADE80',
  violet500: '#8B5CF6',
  orange500: '#F97316',
  lime400: '#C6F432',
  amber700: '#B45309',
  amber300: '#FCD34D',
  red600: '#C53030',
  red400: '#F87171',
} as const;

export interface ColorScheme {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  /** Highlight colour for emphasised words / links on this scheme's background. */
  highlight: string;
  accent: string;
  accentText: string;
  success: string;
  warning: string;
  danger: string;
  focusRing: string;
}

export const colors: Readonly<Record<'light' | 'dark', ColorScheme>> = {
  light: {
    background: palette.mist50,
    surface: palette.white,
    surfaceRaised: palette.mist100,
    border: palette.mist200,
    textPrimary: palette.mist950,
    textSecondary: palette.mist500,
    highlight: palette.blue700,
    accent: palette.blue600,
    accentText: palette.white,
    success: palette.green700,
    warning: palette.amber700,
    danger: palette.red600,
    focusRing: palette.blue600,
  },
  dark: {
    background: palette.space950,
    surface: palette.space900,
    surfaceRaised: palette.space850,
    border: palette.space700,
    textPrimary: '#F4F6FF',
    textSecondary: palette.space400,
    highlight: palette.blue400,
    accent: palette.blue600,
    accentText: palette.white,
    success: palette.green300,
    warning: palette.amber300,
    danger: palette.red400,
    focusRing: palette.blue400,
  },
};

/**
 * Brand expression shared by web and mobile: category chip colours and the signature
 * gradients ("aurora ribbons" + AI orb). Decorative only — never the sole carrier of meaning.
 */
export const brand = {
  category: {
    blue: palette.blue600,
    green: palette.green500,
    violet: palette.violet500,
    orange: palette.orange500,
  },
  ribbonCool: [palette.blue600, palette.violet500],
  ribbonWarm: [palette.lime400, palette.green500],
  orb: [palette.blue300, palette.blue600, '#0B2A8F'],
  buttonGradient: [palette.blue400, palette.blue600],
} as const;

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

export const radius = { sm: 8, md: 14, lg: 22, xl: 28, pill: 999 } as const;

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
  const brandVars = [
    ...Object.entries(brand.category).map(([k, v]) => `  --karen-category-${k}: ${v};`),
    `  --karen-ribbon-cool-from: ${brand.ribbonCool[0]};`,
    `  --karen-ribbon-cool-to: ${brand.ribbonCool[1]};`,
    `  --karen-ribbon-warm-from: ${brand.ribbonWarm[0]};`,
    `  --karen-ribbon-warm-to: ${brand.ribbonWarm[1]};`,
  ].join('\n');
  const radii = Object.entries(radius)
    .map(([k, v]) => `  --karen-radius-${k}: ${v}px;`)
    .join('\n');
  return [
    '/* Generated from @karen/ui tokens.ts — do not edit by hand. */',
    `:root {\n${vars(colors.light)}\n${brandVars}\n${radii}\n  --karen-font-sans: ${typography.fontFamily.sans};\n  color-scheme: light;\n}`,
    `.dark {\n${vars(colors.dark)}\n  color-scheme: dark;\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root:not(.light) {\n${vars(colors.dark)
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n')}\n    color-scheme: dark;\n  }\n}`,
    '',
  ].join('\n\n');
}

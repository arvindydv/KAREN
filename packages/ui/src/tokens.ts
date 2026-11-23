/**
 * KAREN design tokens — the single source for colour, type, spacing and radius across
 * web, admin (via generated CSS variables) and mobile (imported directly as numbers/strings).
 * Platform-neutral: no DOM or React Native imports here.
 *
 * Visual direction (product spec §26.1): premium "deep space" theme — navy starfield, frosted
 * glass surfaces, one blue action colour. Softened (2026-11-21): every hue kept but pulled back
 * in saturation/brightness and the navy lifted slightly, so nothing glares on OLED screens. Colour pairs are chosen for WCAG AA text
 * contrast on their surfaces (enforced by tokens.test.ts).
 */

export const palette = {
  // Deep-space navy neutrals (dark scheme backbone).
  space950: '#0A0F24',
  space900: '#111833',
  space850: '#172042',
  space800: '#1E284D',
  space700: '#2B365F',
  space400: '#9CA6C8',
  space300: '#C4CBE3',
  // Light scheme neutrals (cool periwinkle).
  mist50: '#F3F5FB',
  mist100: '#E8EBF5',
  mist200: '#D3D9EC',
  mist500: '#4F5878',
  mist950: '#0E1430',
  white: '#FFFFFF',
  // Brand blue (primary actions).
  blue700: '#2A5BC9',
  blue600: '#3A6FE0',
  blue400: '#7FAEF2',
  blue300: '#A9C8F5',
  // Category accents (icon chips, charts).
  green500: '#3FBF7F',
  green700: '#1e7a52',
  green300: '#5FD49A',
  violet500: '#8E7CEB',
  orange500: '#EE8A4E',
  lime400: '#CDE77A',
  amber700: '#9A5B0E',
  amber300: '#F2C96B',
  red600: '#C03A3A',
  red400: '#F48A8A',
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
    textPrimary: '#EEF1FB',
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
  orb: [palette.blue300, palette.blue600, '#1A3580'],
  // Both stops keep white label text ≥ 4.5:1.
  buttonGradient: [palette.blue600, palette.blue700],
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

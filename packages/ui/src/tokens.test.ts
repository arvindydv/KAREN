import { describe, expect, it } from 'vitest';
import { colors, contrastRatio, tokensToCss } from './index.js';

describe('design tokens', () => {
  it.each(['light', 'dark'] as const)(
    '%s scheme text meets WCAG AA (4.5:1) on its surfaces',
    (scheme) => {
      const c = colors[scheme];
      for (const bg of [c.background, c.surface]) {
        expect(contrastRatio(c.textPrimary, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(c.textSecondary, bg)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrastRatio(c.accentText, c.accent)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('emits a CSS variable for every colour token in both schemes', () => {
    const css = tokensToCss();
    for (const key of Object.keys(colors.light)) {
      const name = `--karen-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
      expect(css.split(name).length - 1).toBeGreaterThanOrEqual(3);
    }
  });
});

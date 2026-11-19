/** WCAG 2.x relative-luminance contrast ratio for #RRGGBB colours. */
export function contrastRatio(foreground: string, background: string): number {
  const lum = (hex: string) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m?.[1]) throw new RangeError(`Expected #RRGGBB, got ${hex}`);
    const n = parseInt(m[1], 16);
    const channel = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * channel((n >> 16) & 255) +
      0.7152 * channel((n >> 8) & 255) +
      0.0722 * channel(n & 255)
    );
  };
  const [a, b] = [lum(foreground), lum(background)].sort((x, y) => y - x) as [number, number];
  return (a + 0.05) / (b + 0.05);
}

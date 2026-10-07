/**
 * The arithmetic that lets a band pick any two colours and still send a readable quote.
 *
 * The header's text is whichever of white or near-black reads better on the colour chosen, and
 * the accent, which is used for text on white, is darkened just enough to be legible there. A
 * band choosing a pale gold gets a gold that still reads, rather than a total nobody can see.
 */

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toHex = ([r, g, b]: number[]) =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/** Relative luminance, as WCAG defines it. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const INK = '#14161a';

/** The text colour for something sitting on `background`. */
export const textOn = (background: string) =>
  contrast(background, '#ffffff') >= contrast(background, INK) ? '#ffffff' : INK;

/** `hex`, darkened only as far as it takes to read as text on white (WCAG AA, 4.5:1). */
export function readableOnWhite(hex: string): string {
  const base = rgb(hex);
  for (let k = 0; k <= 1; k += 0.05) {
    const candidate = toHex(base.map((c) => c * (1 - k)));
    if (contrast(candidate, '#ffffff') >= 4.5) return candidate;
  }
  return INK;
}

/** A few starting points; the pickers beside them take any colour at all. */
export const PALETTES: Array<{ name: string; primary: string; accent: string }> = [
  { name: 'סגול', primary: '#241d3d', accent: '#6b45d6' },
  { name: 'לילה', primary: '#14161a', accent: '#3b5bdb' },
  { name: 'יין', primary: '#4a1d2f', accent: '#c2185b' },
  { name: 'יער', primary: '#1f3a2e', accent: '#2f9e6e' },
  { name: 'ים', primary: '#0f2c45', accent: '#1c7ed6' },
  { name: 'זהב', primary: '#1c1917', accent: '#b8860b' },
  { name: 'שמנת', primary: '#f3ece1', accent: '#8a5a2b' },
];

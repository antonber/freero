// Small color helpers for avatars and swatches.

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance (0..1). */
export function luminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * White or dark ink, whichever has the higher contrast on the given background — so a mid-tone
 * user colour (orange, teal) gets dark initials that pass WCAG AA instead of white ones at ~3.5:1.
 */
export function readableTextColor(bg: string, dark = '#17162b', light = '#ffffff'): string {
  if (!parseHex(bg)) return light;
  const best = contrastRatio(bg, dark) > contrastRatio(bg, light) ? dark : light;
  // Some mid-tones (a bright blue, a teal) reach 4.5:1 with neither ink: black does.
  if (contrastRatio(bg, best) < 4.5 && contrastRatio(bg, '#000000') > contrastRatio(bg, best)) return '#000000';
  return best;
}

/** "Ada Lovelace" -> "AL", "ada" -> "A". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

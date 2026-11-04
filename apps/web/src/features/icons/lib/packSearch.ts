import { iconWords, type ShapePackIcon } from '@freero/shared';

/** A pack as the library searches it: uploaded ones, and the built-in cloud sets (with `words`). */
export interface SearchablePack {
  name: string;
  icons: Array<ShapePackIcon & { words?: string }>;
}

/**
 * The icons of `pack` that have every typed word in their name, the pack's name or their extra words
 * (a cloud icon's category, Kubernetes' short names). Best first: the ones whose own name has every
 * word, shortest name first ("lambda" → "AWS Lambda" before "AWS Lambda – Lambda Function"); with
 * no query, the pack's order.
 */
export function searchPack(pack: SearchablePack, query: string): SearchablePack['icons'] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return pack.icons;
  const packWords = iconWords(pack.name);
  const scored: Array<{ ic: SearchablePack['icons'][number]; own: boolean }> = [];
  for (const ic of pack.icons) {
    const name = iconWords(ic.name);
    const hay = `${name} ${packWords}${ic.words ? ` ${iconWords(ic.words)}` : ''}`;
    if (words.every((w) => hay.includes(w))) scored.push({ ic, own: words.every((w) => name.includes(w)) });
  }
  return scored.sort((a, b) => Number(b.own) - Number(a.own) || a.ic.name.length - b.ic.name.length).map((s) => s.ic);
}

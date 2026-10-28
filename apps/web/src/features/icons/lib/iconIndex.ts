// The searchable icon index. LAZY: only the library panel imports this module, with import(), so
// the ~1,700 lucide drawings land in their own chunk instead of the board bundle.
//
// `lucide-react/icons/index` is lucide's per-icon module list (not the main barrel the rest of
// the app imports from), so the icons the chrome uses stay in the board chunk and the rest only
// arrive when someone opens the library.
import * as modules from 'lucide-react/icons/index';
import type { IconNode } from '@freero/shared';
import { cleanNodes } from './nodes';

export interface IconEntry {
  /** kebab-case lucide name, e.g. 'alarm-clock-check'. */
  name: string;
  /** Lower-case words to search: name parts and aliases. */
  words: string;
  nodes: IconNode[];
}

interface LucideIconData {
  name: string;
  node: Array<[string, Record<string, string>]>;
  aliases?: string[];
}

/**
 * lucide-react keeps each drawing on the component (createLucideIcon passes it to <Icon icon=…>);
 * rendering the forwardRef once, without mounting, hands it back.
 */
function dataOf(component: unknown): LucideIconData | null {
  const render = (component as { render?: (props: object, ref: null) => { props?: { icon?: unknown } } } | null)?.render;
  if (typeof render !== 'function') return null;
  const icon = render({}, null)?.props?.icon as LucideIconData | undefined;
  return icon && typeof icon.name === 'string' && Array.isArray(icon.node) ? icon : null;
}

let cache: IconEntry[] | null = null;

export function iconIndex(): IconEntry[] {
  if (cache) return cache;
  const out: IconEntry[] = [];
  for (const value of Object.values(modules as unknown as Record<string, unknown>)) {
    const data = dataOf(value);
    if (!data) continue;
    const nodes = cleanNodes(data.node.map(([tag, { key: _key, ...attrs }]) => [tag, attrs]));
    if (!nodes.length) continue;
    const words = [data.name, ...(data.aliases ?? [])].join(' ').replace(/-/g, ' ');
    out.push({ name: data.name, words: `${data.name} ${words}`.toLowerCase(), nodes });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return (cache = out);
}

/**
 * Icons matching every typed word (a word matches the start of any name/alias word, or the
 * whole hyphenated name), best first: exact name, then name prefix, then the rest A–Z.
 */
export function searchIcons(index: IconEntry[], query: string): IconEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return index;
  const terms = q.split(/[\s-]+/).filter(Boolean);
  const hits = index.filter((e) => {
    const words = e.words.split(' ');
    return terms.every((t) => words.some((w) => w.startsWith(t)));
  });
  const joined = terms.join('-');
  const rank = (e: IconEntry) => (e.name === joined ? 0 : e.name.startsWith(joined) ? 1 : 2);
  return hits.sort((a, b) => rank(a) - rank(b) || a.name.length - b.name.length || a.name.localeCompare(b.name));
}

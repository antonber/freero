// Translation discovery root (docs/design/i18n.md) — with app/board/features.ts, the only
// import.meta.glob in the web app [W6]. Every unit's `locales/<lang>.json` is found here; there is
// no list of catalogues to edit. English isn't loaded here: each unit's messages.ts bundles its
// own en.json. vite.config.ts puts each language's files into one chunk.
import type { Catalog, Catalogs } from '@ui';
import type { Locale } from '@freero/shared';

const files = import.meta.glob<Catalog>(['../../**/locales/*.json', '!../../**/locales/en.json'], { import: 'default' });

/** '../../features/voting/locales/de.json' → { ns: 'features/voting', locale: 'de' } */
export function catalogPath(path: string): { ns: string; locale: string } | null {
  const m = /^(?:\.\.\/)*(.+)\/locales\/([^/]+)\.json$/.exec(path);
  return m ? { ns: m[1], locale: m[2] } : null;
}

/** Every unit's translations for `locale` (keys only; the "@@…" bookkeeping entries are dropped). */
export async function loadCatalogs(locale: Locale): Promise<Catalogs> {
  const out: Catalogs = {};
  await Promise.all(
    Object.entries(files).map(async ([path, load]) => {
      const where = catalogPath(path);
      if (!where || where.locale !== locale) return;
      const messages = await load();
      const clean: Catalog = {};
      for (const [k, v] of Object.entries(messages)) if (!k.startsWith('@@') && typeof v === 'string') clean[k] = v;
      out[where.ns] = clean;
    }),
  );
  return out;
}

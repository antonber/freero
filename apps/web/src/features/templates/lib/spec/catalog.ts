// Spec templates in the catalog: the index (names, words, categories) ships with the picker; a
// spec's content loads with its file the first time one of its templates is previewed or added.
import type { TemplateDef } from '../types';
import { buildSpec } from './render';
import type { SpecIndexEntry, TemplateSpec } from './types';

export type SpecFiles = Record<string, () => Promise<{ default: TemplateSpec[] }>>;

export function specTemplates(index: SpecIndexEntry[], files: SpecFiles): TemplateDef[] {
  const loading = new Map<string, Promise<void>>();
  const ready = new Map<string, TemplateSpec>();
  const load = (file: string): Promise<void> => {
    let p = loading.get(file);
    if (!p) {
      const loader = files[file];
      p = loader
        ? loader().then((m) => {
            for (const s of m.default) ready.set(s.id, s);
          })
        : Promise.reject(new Error(`No template file "${file}"`));
      // A failed chunk load (offline, a new deploy) is retried on the next attempt.
      p.catch(() => loading.delete(file));
      loading.set(file, p);
    }
    return p;
  };
  return index.map((e) => ({
    id: e.id,
    name: e.name,
    description: e.description,
    categories: e.categories,
    keywords: e.keywords,
    load: () => load(e.file),
    build(newId) {
      const spec = ready.get(e.id);
      if (!spec) throw new Error(`Template ${e.id} is not loaded: await its load() before building it`);
      return buildSpec(spec, newId);
    },
  }));
}

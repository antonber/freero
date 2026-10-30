// How the app reaches the built-in catalog: as a chunk of its own, loaded the first time the
// picker opens or a template is inserted by id, so opening a board doesn't download the catalog
// (its builders and the spec index grow with every template). Each spec file's content is a
// further chunk, loaded on first preview or insert (spec/catalog.ts).
import type { TemplateDef } from '../types';

let loading: Promise<TemplateDef[]> | null = null;

export function loadTemplates(): Promise<TemplateDef[]> {
  if (!loading) {
    const p = import('./index').then((m) => m.TEMPLATES);
    // A failed chunk load (offline, a new deploy) is retried on the next call.
    p.catch(() => {
      if (loading === p) loading = null;
    });
    loading = p;
  }
  return loading;
}

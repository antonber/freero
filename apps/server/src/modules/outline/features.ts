// How each element type reads in the outline is declared by the web feature that defines it, in
// its reserved `features/<name>/outline.ts` (pure: @freero/shared and its own files only, checked
// by dune-check [W13]). Discovered from the file system once, like server modules are — there is
// no list of element types here. The Docker image ships apps/web/src/features for this.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { outlineKinds, type OutlineFeature } from '@freero/shared';

const FEATURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../web/src/features');

let loading: Promise<OutlineFeature[]> | null = null;

async function load(dir: string): Promise<OutlineFeature[]> {
  if (!fs.existsSync(dir)) throw new Error(`outline: the web features folder is missing (${dir}); the server reads features/*/outline.ts from it`);
  const out: OutlineFeature[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name, 'outline.ts');
    if (!fs.existsSync(file)) continue;
    const mod = (await import(pathToFileURL(file).href)) as { default?: OutlineFeature | OutlineFeature[] };
    if (!mod.default) throw new Error(`outline: features/${name}/outline.ts has no default export (defineOutline({...}))`);
    out.push(...[mod.default].flat());
  }
  outlineKinds(out); // two features describing one element type fail here, at startup
  return out;
}

/** Every feature's outline declaration (loaded once). */
export function outlineFeatures(): Promise<OutlineFeature[]> {
  loading ??= load(FEATURES_DIR).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

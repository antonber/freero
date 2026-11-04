// The vendors' cloud icon sets (#4): generated files, so these guard what a regeneration, a vendor's
// new package or a hand edit could break.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin, type Rollup } from 'vite';
import { describe, expect, it } from 'vitest';
import { CLOUD_ICON_SETS, cleanIconNodes, cleanViewBox, ICON_LIMITS } from '@freero/shared';
import { packOf, type CloudSetFile } from './lib/cloudPacks';
import { searchPack } from './lib/packSearch';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'lib/cloud');
const read = (id: string) => JSON.parse(fs.readFileSync(path.join(DATA, `${id}.json`), 'utf8')) as CloudSetFile;

describe('bundled cloud icon sets', () => {
  it('every bundled icon is exactly what the board’s sanitiser keeps — nothing dropped or cut short when drawn — and keeps its own colours', () => {
    for (const { id } of CLOUD_ICON_SETS) {
      const file = read(id);
      expect(file.icons.length, id).toBeGreaterThan(0);
      for (const [name, , viewBox, nodes] of file.icons) {
        // Every reader (board, exports, the server's SVG render) draws cleanIconNodes(nodes): a
        // drawing it would change, or one at its limits (where it stops reading), isn't the icon as shipped.
        expect(cleanIconNodes(nodes), `${id}: ${name}`).toEqual(nodes);
        expect(nodes.length, `${id}: ${name}`).toBeGreaterThan(0);
        expect(nodes.length, `${id}: ${name}`).toBeLessThan(ICON_LIMITS.nodes);
        expect(JSON.stringify(nodes).length, `${id}: ${name}`).toBeLessThan(ICON_LIMITS.chars);
        expect(cleanViewBox(viewBox), `${id}: ${name}`).toBe(viewBox);
        expect(name.length, `${id}: ${name}`).toBeLessThanOrEqual(ICON_LIMITS.name);
        // The vendors' terms: never recoloured, so no paint follows the board's colour.
        expect(JSON.stringify(nodes), `${id}: ${name}`).not.toContain('currentColor');
      }
    }
  });

  it('finds a cloud icon by its service name, best match first, and Kubernetes objects by their short names', () => {
    const aws = packOf('aws', read('aws'));
    expect(searchPack(aws, 'lambda')[0].name).toBe('AWS Lambda');
    expect(searchPack(packOf('azure', read('azure')), 'virtual machine')[0].name).toBe('Virtual Machine');
    expect(searchPack(packOf('kubernetes', read('kubernetes')), 'svc').map((i) => i.name)).toEqual(['Service']);
  });

  it('the board bundle carries no cloud icon set: each is a chunk of its own, fetched when the library shows it', async () => {
    // The icon and shape features' reserved files are what the board loads; bundle them (everything
    // outside the features external) and see where the sets land.
    const features = path.resolve(HERE, '..');
    const entries = ['icons', 'shape'].flatMap((f) =>
      ['feature.ts', 'element.tsx', 'tool.tsx', 'format.tsx', 'panel.tsx', 'commands.ts', 'outline.ts'].map((n) => path.join(features, f, n)).filter((p) => fs.existsSync(p)),
    );
    const external: Plugin = {
      name: 'external-packages',
      enforce: 'pre',
      resolveId: (id) => (/^[@a-z]/i.test(id) && !/^[a-z]:[\\/]/i.test(id) ? { id, external: true } : null),
    };
    const out = (await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [external],
      build: { write: false, minify: false, rollupOptions: { input: entries } },
    })) as Rollup.RollupOutput;
    const chunks = out.output.filter((o): o is Rollup.OutputChunk => o.type === 'chunk');
    const byName = new Map(chunks.map((c) => [c.fileName, c]));
    const ids = new Set<string>(CLOUD_ICON_SETS.map((s) => s.id));
    const setOf = (moduleId: string) => {
      const m = /[\\/]cloud[\\/]([a-z]+)\.json/.exec(moduleId)?.[1];
      return m && ids.has(m) ? m : undefined;
    };

    // What the board loads up front: the entries and everything they import statically.
    const eager = new Set<string>();
    const visit = (c: Rollup.OutputChunk | undefined) => {
      if (!c || eager.has(c.fileName)) return;
      eager.add(c.fileName);
      c.imports.forEach((f) => visit(byName.get(f)));
    };
    chunks.filter((c) => c.isEntry).forEach(visit);
    for (const f of eager) expect(Object.keys(byName.get(f)!.modules).map(setOf).filter(Boolean), f).toEqual([]);

    for (const { id } of CLOUD_ICON_SETS) {
      const holding = chunks.filter((c) => Object.keys(c.modules).some((m) => setOf(m) === id));
      expect(holding.map((c) => c.fileName), id).toHaveLength(1);
      expect(new Set(Object.keys(holding[0].modules).map(setOf).filter(Boolean)), id).toEqual(new Set([id]));
      expect(holding[0].isDynamicEntry, id).toBe(true);
    }
  }, 60_000);
});

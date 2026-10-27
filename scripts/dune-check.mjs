#!/usr/bin/env node
// Dune boundary checker for Freero. Run: `npm run check:dune`.
//
// Makes forbidden dependencies fail mechanically, with an error that names the
// supported path. Rules are documented in ARCHITECTURE.md. Exceptions must be
// listed in dune.exceptions.json with a reason (they are architecture changes).

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const WEB = path.join(ROOT, 'apps/web/src');
const SERVER = path.join(ROOT, 'apps/server/src');
const SHARED = path.join(ROOT, 'packages/shared/src');

const YJS_PKGS = ['yjs', 'y-websocket', 'y-protocols', 'lib0'];
const FEATURE_RESERVED = new Set([
  'feature.ts',
  'element.tsx',
  'tool.tsx',
  'format.tsx',
  'panel.tsx',
  'commands.ts',
  'decoration.tsx',
]);

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const errors = [];
const exceptions = loadExceptions();

function loadExceptions() {
  const file = path.join(ROOT, 'dune.exceptions.json');
  if (!fs.existsSync(file)) return [];
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const e of list) {
    if (!e.rule || !e.file || !e.reason || e.reason.trim().length < 10) {
      console.error(`dune.exceptions.json: every exception needs rule, file and a real reason: ${JSON.stringify(e)}`);
      process.exit(1);
    }
  }
  return list;
}

function report(rule, file, line, message, spec) {
  const r = rel(file);
  if (exceptions.some((e) => e.rule === rule && e.file === r && (!e.import || e.import === spec))) return;
  errors.push(`${r}:${line}  [${rule}] ${message}`);
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'dist') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const isCode = (f) => /\.(ts|tsx|mts|js|mjs)$/.test(f) && !f.endsWith('.d.ts');

/** Returns [{ spec, line, kind }] for every import/export-from/dynamic import/glob. */
function parseImports(src) {
  const out = [];
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;
  const patterns = [
    [/(?:^|[\s;])import\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]/g, 'import'],
    [/(?:^|[\s;])export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g, 'export'],
    [/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, 'dynamic'],
    [/\bimport\.meta\.glob\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`]+)['"`]/g, 'glob'],
    [/\bimport\.meta\.glob\s*(?:<[^>]*>)?\s*\(\s*\[\s*['"`]([^'"`]+)['"`]/g, 'glob'],
  ];
  for (const [re, kind] of patterns) {
    for (const m of src.matchAll(re)) {
      const lead = m[0].length - m[0].replace(/^[\s;]+/, '').length;
      out.push({ spec: m[1], line: lineOf(m.index + lead), kind });
    }
  }
  return out;
}

const pkgName = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

// ---------------------------------------------------------------------------
// Web layers
// ---------------------------------------------------------------------------
function webLayer(abs) {
  const r = path.relative(WEB, abs).split(path.sep);
  if (r[0] === '..' || path.isAbsolute(r[0])) return null;
  if (r[0] === 'features') return { layer: 'features', feature: r[1] };
  if (['ui', 'engine', 'app'].includes(r[0])) return { layer: r[0] };
  return { layer: 'root' }; // main.tsx etc.
}

function resolveWeb(fromFile, spec) {
  if (spec === '@engine') return { alias: 'engine', abs: path.join(WEB, 'engine/index.ts') };
  if (spec === '@ui') return { alias: 'ui', abs: path.join(WEB, 'ui/index.ts') };
  if (spec.startsWith('@engine/') || spec.startsWith('@ui/'))
    return { deepAlias: true };
  if (spec.startsWith('.')) return { abs: path.resolve(path.dirname(fromFile), spec) };
  if (spec.startsWith('/')) return { abs: path.join(WEB, spec) };
  return { pkg: pkgName(spec) };
}

function checkWebFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const me = webLayer(file);
  const meRel = path.relative(WEB, file).split(path.sep).join('/');
  // Raw HTML sinks live only in engine/text/, which owns sanitizing (board content is untrusted
  // input from other users — a stored-XSS bug was found exactly here).
  if (!meRel.startsWith('engine/text/') && !/\.test\.tsx?$/.test(file)) {
    for (const m of src.matchAll(/\b(innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML|dangerouslySetInnerHTML|createContextualFragment)/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      report('W11', file, line, `Raw HTML sink '${m[1].replace(/\s*=$/, '')}' outside engine/text/. Render rich text with ElementText, or sanitizeRichText/plainToRichText from '@engine' plus normal React text — board content is untrusted.`);
    }
  }
  // Only the app shell talks to Freero's server; everything below it goes through the Host.
  if (['features', 'engine', 'ui'].includes(me.layer) && !/\.test\.tsx?$/.test(file)) {
    for (const m of src.matchAll(/['"`]\/(api|ws)\//g)) {
      const line = src.slice(0, m.index).split('\n').length;
      report('W9', file, line, `${me.layer}/ must not call Freero's server ('/${m[1]}/…') directly. Use editor.host; if the Host lacks what you need, add a typed method to Host in engine/api.ts and implement it in app/board/host.ts.`);
    }
  }
  // Toasts from features go through the Host, so actions and durations stay one app policy.
  if (me.layer === 'features' && !/\.test\.tsx?$/.test(file)) {
    for (const m of src.matchAll(/\buseToast\s*\(/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      report('W10', file, line, `Features don't call useToast(). Use editor.host.notify(message, kind, { action: { label, run } }).`);
    }
  }
  for (const { spec, line, kind } of parseImports(src)) {
    if (kind === 'glob') {
      if (meRel !== 'app/board/features.ts')
        report('W6', file, line, `import.meta.glob is only allowed in apps/web/src/app/board/features.ts (the feature discovery root). Add a reserved file to your feature instead of a new registry.`, spec);
      continue;
    }
    const t = resolveWeb(file, spec);
    if (t.deepAlias) {
      report('W0', file, line, `Deep alias '${spec}' is not allowed. Import from '@engine' or '@ui' (their index.ts is the public surface).`, spec);
      continue;
    }
    if (t.pkg) {
      if (YJS_PKGS.includes(t.pkg) && !meRel.startsWith('engine/store/'))
        report('W5', file, line, `'${t.pkg}' may only be imported in engine/store/. Board state has one writer: use editor.create/update/remove/transact or editor.collection(name).`, spec);
      if (t.pkg === 'react-router-dom' && me.layer !== 'app' && me.layer !== 'root')
        report('W4', file, line, `Routing belongs to the app shell. Use editor.host.navigate(path).`, spec);
      continue;
    }
    const target = t.alias ? { layer: t.alias } : webLayer(t.abs);
    if (!target) continue; // outside src (e.g. shared via relative) — not expected
    const deepEngine = !t.alias && target.layer === 'engine';
    const deepUi = !t.alias && target.layer === 'ui';

    switch (me.layer) {
      case 'ui':
        if (target.layer !== 'ui')
          report('W1', file, line, `ui/ is the bottom layer and may only import ui/, @freero/shared and packages. Move the shared piece into ui/ or pass it in as props.`, spec);
        break;
      case 'engine':
        if (target.layer === 'features' || target.layer === 'app' || target.layer === 'root')
          report('W2', file, line, `engine/ must never import ${target.layer}/. Add an extension point to engine/api.ts and let features register through a reserved file (element/tool/format/panel/commands).`, spec);
        else if (deepUi)
          report('W0', file, line, `Import ui through '@ui', not a relative path.`, spec);
        break;
      case 'features':
        if (target.layer === 'features' && target.feature !== me.feature)
          report('W3', file, line, `features/${me.feature} cannot import features/${target.feature}. Features share only through the engine: read elements or editor.collection('${target.feature}…'), or call editor.runCommand('${target.feature}.<verb>').`, spec);
        else if (target.layer === 'app' || target.layer === 'root')
          report('W3', file, line, `Features cannot import the app shell. Use editor.host (uploadImage, navigate, notify, openShareDialog, …).`, spec);
        else if (deepEngine)
          report('W0', file, line, `Import the engine through '@engine' only; '${spec}' reaches into engine internals.`, spec);
        else if (deepUi)
          report('W0', file, line, `Import ui through '@ui', not a relative path.`, spec);
        break;
      case 'app':
      case 'root':
        if (target.layer === 'features')
          report('W4', file, line, `The app never imports features directly. Features are discovered by app/board/features.ts via reserved files.`, spec);
        else if (deepEngine)
          report('W0', file, line, `Import the engine through '@engine' only; '${spec}' reaches into engine internals.`, spec);
        else if (deepUi)
          report('W0', file, line, `Import ui through '@ui', not a relative path.`, spec);
        break;
    }
  }
}

function checkFeatureFolders() {
  const dir = path.join(WEB, 'features');
  if (!fs.existsSync(dir)) return;
  const owners = new Map();
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) {
      report('W7', path.join(dir, ent.name), 1, `Only feature folders may live in features/. Run \`npm run new:feature <name>\`.`);
      continue;
    }
    const fdir = path.join(dir, ent.name);
    if (!/^[a-z][a-z0-9-]*$/.test(ent.name))
      report('W7', fdir, 1, `Feature folder names are kebab-case: '${ent.name}'.`);
    const manifest = path.join(fdir, 'feature.ts');
    if (!fs.existsSync(manifest)) {
      report('W7', fdir, 1, `features/${ent.name} is missing its manifest feature.ts. Run \`npm run new:feature ${ent.name}\` to scaffold.`);
    } else {
      const src = fs.readFileSync(manifest, 'utf8');
      const name = src.match(/name:\s*['"]([^'"]+)['"]/)?.[1];
      if (name !== ent.name)
        report('W7', manifest, 1, `Manifest name '${name}' must equal the folder name '${ent.name}'.`);
      const owns = src.match(/owns:\s*\[([^\]]*)\]/)?.[1];
      for (const c of owns ? [...owns.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]) : []) {
        if (['elements', 'settings'].includes(c))
          report('W8', manifest, 1, `'${c}' is owned by the engine; features cannot claim it.`);
        else if (owners.has(c))
          report('W8', manifest, 1, `Collection '${c}' is already owned by feature '${owners.get(c)}'. Every durable value has one writer.`);
        else owners.set(c, ent.name);
      }
    }
    for (const f of fs.readdirSync(fdir, { withFileTypes: true })) {
      if (f.isDirectory()) continue;
      const ok =
        FEATURE_RESERVED.has(f.name) || f.name.endsWith('.css') || /\.test\.tsx?$/.test(f.name);
      if (!ok)
        report('W7', path.join(fdir, f.name), 1, `'${f.name}' is not a reserved feature file (${[...FEATURE_RESERVED].join(', ')}). Put helpers in features/${ent.name}/lib/.`);
    }
  }
}

// ---------------------------------------------------------------------------
// CSS class ownership. Vite never unloads CSS on route changes, so after visiting a board the
// board's stylesheets also apply to the dashboard. A class styled by two sibling owners leaks.
// ui/ (design system) and engine/ classes may be styled in context by layers above them; app/
// and each feature must otherwise use classes nobody else styles.
// ---------------------------------------------------------------------------
function checkCssOwnership() {
  const units = new Map(); // class -> Map(unit -> firstFile)
  for (const file of walk(WEB).filter((f) => f.endsWith('.css'))) {
    const r = path.relative(WEB, file).split(path.sep);
    const unit = r[0] === 'features' ? `features/${r[1]}` : r[0];
    const css = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/\.(fr-[a-zA-Z0-9_-]+)/g)) {
      if (!units.has(m[1])) units.set(m[1], new Map());
      if (!units.get(m[1]).has(unit)) units.get(m[1]).set(unit, file);
    }
  }
  for (const [cls, owners] of units) {
    if (owners.has('ui') || owners.has('engine')) {
      if (owners.has('engine') && owners.has('app') && !owners.has('ui'))
        report('W12', owners.get('app'), 1, `.${cls} is styled by both app/ and engine/. Board CSS stays loaded on the dashboard; give app classes their own prefix (e.g. fr-dash-, fr-app-).`);
      continue;
    }
    const names = [...owners.keys()];
    if (names.length > 1)
      report('W12', owners.get(names[1]), 1, `.${cls} is styled by ${names.join(' and ')}. CSS stays loaded across routes, so these leak into each other; prefix classes by owner (fr-<feature>-…, fr-dash-…).`);
  }
}

// ---------------------------------------------------------------------------
// Server layers
// ---------------------------------------------------------------------------
function serverLayer(abs) {
  const r = path.relative(SERVER, abs).split(path.sep);
  if (r[0] === '..') return null;
  if (r[0] === 'modules') return { layer: 'modules', module: r[1], file: r.slice(2).join('/') };
  if (r[0] === 'platform') return { layer: 'platform', file: r.slice(1).join('/') };
  return { layer: 'root' };
}

function checkServerFile(file, tableOwners) {
  const src = fs.readFileSync(file, 'utf8');
  const me = serverLayer(file);
  for (const { spec, line } of parseImports(src)) {
    if (!spec.startsWith('.')) continue;
    let abs = path.resolve(path.dirname(file), spec).replace(/\.js$/, '.ts');
    // A bare directory import ('../auth') resolves to its index.ts.
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) abs = path.join(abs, 'index.ts');
    const t = serverLayer(abs);
    if (!t) continue;
    if (me.layer === 'platform' && t.layer === 'modules')
      report('S1', file, line, `platform/ is the framework and never imports modules/. Expose a hook in platform and let the module register through a reserved file (routes.ts, ws.ts, schema.sql).`, spec);
    if (me.layer === 'modules' && t.layer === 'modules' && t.module !== me.module && !/^index(\.ts)?$/.test(t.file))
      report('S2', file, line, `modules/${me.module} may use modules/${t.module} only through its public index.ts.`, spec);
    if (t.layer === 'platform' && /^db(\.ts)?$/.test(t.file) && !(me.layer === 'modules' && me.file === 'repo.ts') && me.layer !== 'platform' && me.layer !== 'root')
      report('S3', file, line, `Only a module's repo.ts may touch the database. Call the owning module's repo/service functions instead.`, spec);
  }
  // Table writes only from the owning module's repo.ts.
  for (const m of src.matchAll(/\b(INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM|REPLACE\s+INTO)\s+["`]?(\w+)/gi)) {
    const table = m[2].toLowerCase();
    const owner = tableOwners.get(table);
    if (!owner) continue;
    const line = src.slice(0, m.index).split('\n').length;
    if (!(me.layer === 'modules' && me.module === owner && me.file === 'repo.ts'))
      report('S4', file, line, `Table '${table}' is owned by modules/${owner}; only modules/${owner}/repo.ts may write it. Call modules/${owner}'s exported functions.`);
  }
}

function serverTableOwners() {
  const owners = new Map();
  const dir = path.join(SERVER, 'modules');
  if (!fs.existsSync(dir)) return owners;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const schema = path.join(dir, ent.name, 'schema.sql');
    if (!fs.existsSync(schema)) continue;
    for (const m of fs.readFileSync(schema, 'utf8').matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)/gi)) {
      const t = m[1].toLowerCase();
      if (owners.has(t)) report('S4', schema, 1, `Table '${t}' is already defined by modules/${owners.get(t)}.`);
      owners.set(t, ent.name);
    }
  }
  return owners;
}

// ---------------------------------------------------------------------------
// Shared package: pure types/constants, no runtime deps.
// ---------------------------------------------------------------------------
function checkSharedFile(file) {
  for (const { spec, line } of parseImports(fs.readFileSync(file, 'utf8'))) {
    if (!spec.startsWith('.'))
      report('P1', file, line, `@freero/shared must stay dependency-free (types + constants). '${spec}' belongs in an app.`, spec);
  }
}

// ---------------------------------------------------------------------------
for (const f of walk(WEB).filter(isCode)) checkWebFile(f);
checkFeatureFolders();
checkCssOwnership();
const owners = serverTableOwners();
for (const f of walk(SERVER).filter(isCode)) checkServerFile(f, owners);
for (const f of walk(SHARED).filter(isCode)) checkSharedFile(f);

if (errors.length) {
  console.error(`dune-check: ${errors.length} boundary violation(s)\n`);
  for (const e of errors) console.error('  ' + e);
  console.error('\nSee ARCHITECTURE.md. Exceptions go in dune.exceptions.json with a reason (architecture review).');
  process.exit(1);
}
console.log('dune-check: all boundaries hold.');

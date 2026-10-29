#!/usr/bin/env node
// Licence check (KAI-162): Freero is MIT, so every installed dependency must be under a licence an
// MIT project may ship. Fails `npm run check` on copyleft (GPL, AGPL, LGPL, SSPL), source-available
// (BUSL, Elastic, Commons Clause) or proprietary / unknown licences, and on packages known to be
// commercial or GPL whatever their manifest says: BlockNote's "XL" packages (@blocknote/xl-*),
// Tiptap Pro (@tiptap-pro/*) and HyperFormula. MPL-2.0 is allowed (file-level copyleft: BlockNote's
// core packages; we use them unmodified).
//
// Exceptions go in ALLOWED_UNDECLARED below with the licence checked by hand and where.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const PERMISSIVE = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'Unlicense',
  'Python-2.0',
  'Zlib',
  'WTFPL',
  'MPL-2.0',
  // Fonts only (the Inter files the marketing site self-hosts, @fontsource/inter): the SIL Open Font
  // License lets anyone bundle, embed and redistribute the font with any software; it only forbids
  // selling the font by itself and reusing its reserved name for modified versions.
  'OFL-1.1',
]);

/** Packages whose manifest declares no usable licence, checked by hand. */
const ALLOWED_UNDECLARED = {
  // MIT per its LICENSE file (https://github.com/bwindels/exif-parser); the manifest has no field.
  'exif-parser': 'MIT (LICENSE file)',
};

/** Never allowed, whatever their manifest says. */
const FORBIDDEN = [/^@blocknote\/xl-/, /^@tiptap-pro\//, /^hyperformula$/];

function licenceOf(pkg) {
  let l = pkg.license ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((x) => x.type ?? x).join(' OR ') : undefined);
  if (l && typeof l === 'object') l = l.type;
  return typeof l === 'string' ? l.trim() : null;
}

/** True when an SPDX expression can be satisfied with permissive licences only. */
function acceptable(expr) {
  const e = expr.replace(/[()]/g, ' ').trim();
  // "A OR B": one acceptable alternative is enough; "A AND B": all must be.
  return e.split(/\s+OR\s+/).some((alt) => alt.split(/\s+AND\s+/).every((id) => PERMISSIVE.has(id.trim())));
}

const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const problems = [];
let checked = 0;
for (const [key, entry] of Object.entries(lock.packages ?? {})) {
  if (!key || entry.link || !key.includes('node_modules/')) continue;
  const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
  if (FORBIDDEN.some((re) => re.test(name))) {
    problems.push(`${name}: not allowed in Freero (commercial or GPL; see scripts/license-check.mjs)`);
    continue;
  }
  const manifest = path.join(ROOT, key, 'package.json');
  if (!fs.existsSync(manifest)) continue; // an optional dependency for another platform
  const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const licence = licenceOf(pkg);
  checked++;
  if (!licence) {
    if (!ALLOWED_UNDECLARED[name]) problems.push(`${name}@${pkg.version}: no licence declared`);
    continue;
  }
  if (!acceptable(licence)) problems.push(`${name}@${pkg.version}: ${licence}`);
}

if (problems.length) {
  console.error(`license-check: ${problems.length} package(s) under a licence Freero (MIT) may not ship:\n  ${problems.join('\n  ')}`);
  console.error('Pick a permissively licensed alternative. An exception needs the licence checked by hand (ALLOWED_UNDECLARED, with where).');
  process.exit(1);
}
console.log(`license-check: ${checked} installed packages, all under licences an MIT project may ship.`);

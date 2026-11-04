#!/usr/bin/env node
// Licence check (KAI-162): Freero is MIT, so every installed dependency must be under a licence an
// MIT project may ship. Fails `npm run check` on copyleft (GPL, AGPL, LGPL, SSPL), source-available
// (BUSL, Elastic, Commons Clause) or proprietary / unknown licences, and on packages known to be
// commercial or GPL whatever their manifest says: BlockNote's "XL" packages (@blocknote/xl-*),
// Tiptap Pro (@tiptap-pro/*) and HyperFormula. MPL-2.0 is allowed (file-level copyleft: BlockNote's
// core packages; we use them unmodified).
//
// Exceptions go in ALLOWED_UNDECLARED below with the licence checked by hand and where.
//
// Sounds: Freero ships no audio files. The timer's chime and its background music tracks (#145:
// Drift, Pulse, Rain) are composed and synthesized at run time by Freero's own MIT code
// (apps/web/src/features/timer/lib/music.ts, musicPlayer.ts, chime.ts) — no samples, recordings
// or third-party compositions. Adding a recorded sound means recording its licence here.
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

// ---- bundled assets that aren't npm packages ----
//
// The vendors' cloud architecture icon sets (#4): drawn from each vendor's official package by
// scripts/cloud-icons.mjs into apps/web/src/features/icons/lib/cloud/, whose manifest.json names each
// set's licence. They are NOT under Freero's MIT licence; THIRD_PARTY_NOTICES.md says so and carries
// each set's notice. A set may ship only under a licence listed here, each allowed for the reason
// given (the terms, quoted with their URLs and the date they were read: docs/design/cloud-icons.md).
const ASSET_LICENCES = {
  // Apache-2.0 or CC BY 4.0, our choice: we take CC BY 4.0, whose one condition is attribution —
  // credit, the licence's link, and that we changed them (the library's notice and THIRD_PARTY_NOTICES.md).
  'CC-BY-4.0': 'Kubernetes Icons Set (kubernetes/community icons/README.md)',
  // AWS: "We allow customers and partners to use these toolkits and assets to create architecture
  // diagrams", and points people to "preexisting libraries on third-party tools". Freero offers them,
  // unchanged, only as icons people place on their own diagrams; no logo icons, no AWS branding of
  // Freero; AWS's trademark notice in the library.
  'LicenseRef-AWS-Architecture-Icons': 'AWS Architecture Icons (aws.amazon.com/architecture/icons)',
  // Azure: "You may copy, distribute, and display the icons only for the permitted use" — architectural
  // diagrams, training materials, documentation. A shape library for drawing architecture diagrams
  // distributes them for that use; the library repeats Microsoft's don'ts (crop, flip, rotate, distort)
  // and asks for the service's name beside each icon.
  'LicenseRef-Azure-Architecture-Icons': 'Azure architecture icons (learn.microsoft.com/azure/architecture/icons)',
};
/** Sets whose vendor grants no licence to redistribute them: never bundled (users may upload their own copy as a pack). */
const FORBIDDEN_ASSET_SETS = {
  gcp: 'Google Cloud icons: cloud.google.com/icons offers them "for your diagrams" but grants no licence to copy or redistribute them, and the guide marks them proprietary',
  'google-cloud': 'see gcp',
};

const CLOUD = path.join(ROOT, 'apps/web/src/features/icons/lib/cloud');
const assetProblems = [];
let sets = 0;
if (fs.existsSync(CLOUD)) {
  const manifest = JSON.parse(fs.readFileSync(path.join(CLOUD, 'manifest.json'), 'utf8'));
  const notices = fs.readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const files = fs.readdirSync(CLOUD).filter((f) => f !== 'manifest.json');
  for (const f of files) {
    const id = f.replace(/\.json$/, '');
    const entry = manifest.sets.find((s) => s.id === id);
    sets++;
    if (FORBIDDEN_ASSET_SETS[id]) assetProblems.push(`${f}: not allowed in Freero — ${FORBIDDEN_ASSET_SETS[id]}`);
    else if (!entry) assetProblems.push(`${f}: not in manifest.json, so its licence is unknown (regenerate with npm run icons:cloud)`);
    else if (!ASSET_LICENCES[entry.licence]) assetProblems.push(`${f}: licence ${entry.licence} isn't one Freero has checked (ASSET_LICENCES in scripts/license-check.mjs)`);
    else if (!entry.source?.sha256 || !entry.terms) assetProblems.push(`${f}: the manifest doesn't say which official package it came from`);
    else if (!notices.includes(`## ${entry.name} `)) assetProblems.push(`${f}: THIRD_PARTY_NOTICES.md has no "## ${entry.name} …" section with its notice`);
  }
}
if (assetProblems.length) {
  console.error(`license-check: ${assetProblems.length} bundled asset set(s) Freero may not ship as they are:\n  ${assetProblems.join('\n  ')}`);
  process.exit(1);
}
console.log(`license-check: ${checked} installed packages, all under licences an MIT project may ship; ${sets} bundled icon sets, each under a licence checked by hand.`);

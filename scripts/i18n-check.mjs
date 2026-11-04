#!/usr/bin/env node
// Interface-language checker (docs/design/i18n.md). Run: `npm run check:i18n` (part of `npm run check`).
//
// Fails on:
//   - a key used in code that the unit's English catalogue doesn't have, or an English key nothing uses;
//   - a messages.ts whose namespace isn't its unit's path, a locales/ folder without a messages.ts;
//   - a translation key English doesn't have, a message that isn't valid ICU, a translation whose
//     arguments differ from English's;
//   - new hard-coded interface text (JSX text, label / title / aria-label … props, notify(…)) in a
//     file beyond what i18n.baseline.json allows it (the baseline only goes down).
// `--update-baseline` rewrites the baseline from what is there now (only ever to lower it).
// `--status` prints translation coverage and unreviewed counts per language instead.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { LOCALES, messageArguments, validateMessage } from '../packages/shared/src/i18n.ts';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const WEB = path.join(ROOT, 'apps/web/src');
const SERVER = path.join(ROOT, 'apps/server/src');
const BASELINE = path.join(ROOT, 'i18n.baseline.json');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const args = new Set(process.argv.slice(2));
const errors = [];
const fail = (file, msg) => errors.push(`${rel(file)}  ${msg}`);

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
const isSource = (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('.d.ts');
const readJson = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    fail(f, `is not valid JSON: ${e.message}`);
    return {};
  }
};

// ---------------------------------------------------------------------------------------------
// Units: every messages.ts, its namespace, its catalogues and the files it covers
// ---------------------------------------------------------------------------------------------
const webFiles = walk(WEB);
const serverFiles = walk(SERVER);
const units = [];
for (const [side, base, files] of [['web', WEB, webFiles], ['server', SERVER, serverFiles]]) {
  for (const f of files.filter((x) => path.basename(x) === 'messages.ts')) {
    const dir = path.dirname(f);
    const ns = path.relative(base, dir).split(path.sep).join('/') || '.';
    units.push({ side, base, dir, ns, file: f });
  }
  // A locales/ folder belongs to a messages.ts beside it.
  for (const f of files.filter((x) => /[\\/]locales[\\/][^\\/]+\.json$/.test(x))) {
    const owner = path.join(path.dirname(path.dirname(f)), 'messages.ts');
    if (!fs.existsSync(owner)) fail(f, `has no messages.ts beside its locales/ folder. Bind the catalogue with defineMessages in ${rel(owner)}.`);
  }
}
const unitDirs = units.map((u) => u.dir);
/** The innermost unit a file belongs to. */
function unitOfFile(f) {
  let best = null;
  for (const u of units) if (f.startsWith(u.dir + path.sep) && (!best || u.dir.length > best.dir.length)) best = u;
  return best;
}

const IMPORT_RE = /import\s*\{\s*t(?:\s+as\s+(\w+))?\s*\}\s*from\s*['"]([^'"]*\bmessages)['"]/g;

for (const u of units) {
  const src = fs.readFileSync(u.file, 'utf8');
  const declared = /defineMessages\(\s*['"`]([^'"`]+)['"`]/.exec(src)?.[1];
  if (u.side === 'web' && declared !== u.ns)
    fail(u.file, `defineMessages names '${declared}', but this unit is '${u.ns}'. A unit's namespace is its path under apps/web/src.`);
  if (u.side === 'server' && !/defineMessages\(\s*import\.meta\.url/.test(src))
    fail(u.file, `binds its catalogue with defineMessages(import.meta.url, en) (platform/i18n.ts), so it reads its own locales/ folder.`);
  const enFile = path.join(u.dir, 'locales/en.json');
  if (!fs.existsSync(enFile)) {
    fail(u.file, `has no locales/en.json (the English source).`);
    continue;
  }
  u.en = readJson(enFile);
  u.enFile = enFile;
  for (const [k, v] of Object.entries(u.en)) {
    if (typeof v !== 'string') fail(enFile, `'${k}' must be a string.`);
    else
      try {
        validateMessage(v);
      } catch (e) {
        fail(enFile, `'${k}' is not valid ICU: ${e.message}`);
      }
  }
  // Usages in the unit's files (not nested units').
  const used = new Set();
  const prefixes = [];
  const files = (u.side === 'web' ? webFiles : serverFiles).filter((f) => isSource(f) && unitOfFile(f) === u && f !== u.file);
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    for (const m of text.matchAll(IMPORT_RE)) {
      const target = path.resolve(path.dirname(f), m[2]);
      if (target !== path.join(u.dir, 'messages')) {
        fail(f, `imports '${m[2]}', another unit's messages. Use this unit's own messages.ts (features share text only through the engine).`);
        continue;
      }
      const name = m[1] ?? 't';
      const lead = u.side === 'server' ? String.raw`[^,()]+,\s*` : '';
      const call = new RegExp(String.raw`(?<![\w.$])${name}\(\s*${lead}(['"\x60])((?:(?!\1)[^\\$]|\\.)*)(\1|\$\{)`, 'g');
      for (const c of text.matchAll(call)) {
        // t(`status.${s}`) uses every key starting with 'status.'; a key built from nothing but
        // a variable can't be checked, so it counts for none (name the keys instead).
        if (c[3] === '${') {
          if (c[2]) prefixes.push(c[2]);
        }
        else {
          used.add(c[2]);
          if (!(c[2] in u.en)) fail(f, `uses '${c[2]}', which ${rel(enFile)} doesn't have. Add it there (English).`);
        }
      }
    }
  }
  for (const k of Object.keys(u.en)) {
    if (!used.has(k) && !prefixes.some((p) => k.startsWith(p)))
      fail(enFile, `'${k}' is not used by any file of ${u.ns}. Remove it (and its translations).`);
  }
  // Translations.
  u.translations = {};
  for (const lang of LOCALES.filter((l) => l !== 'en')) {
    const file = path.join(u.dir, `locales/${lang}.json`);
    if (!fs.existsSync(file)) continue;
    const data = readJson(file);
    u.translations[lang] = data;
    for (const [k, v] of Object.entries(data)) {
      if (k === '@@unreviewed') {
        if (!Array.isArray(v)) fail(file, `"@@unreviewed" is a list of keys.`);
        else for (const x of v) if (!(x in data)) fail(file, `"@@unreviewed" lists '${x}', which this file doesn't translate.`);
        continue;
      }
      if (k.startsWith('@@')) continue;
      if (!(k in u.en)) {
        fail(file, `translates '${k}', which English no longer has. Remove it.`);
        continue;
      }
      if (typeof v !== 'string') {
        fail(file, `'${k}' must be a string.`);
        continue;
      }
      try {
        validateMessage(v);
        const want = messageArguments(u.en[k]).join(',');
        const got = messageArguments(v).join(',');
        if (want !== got) fail(file, `'${k}' uses {${got}} but English uses {${want}}: a translation keeps the same arguments.`);
      } catch (e) {
        fail(file, `'${k}' is not valid ICU: ${e.message}`);
      }
    }
  }
  for (const f of fs.existsSync(path.join(u.dir, 'locales')) ? fs.readdirSync(path.join(u.dir, 'locales')) : []) {
    const lang = f.replace(/\.json$/, '');
    if (!LOCALES.includes(lang)) fail(path.join(u.dir, 'locales', f), `'${lang}' is not a shipped language (LOCALES in packages/shared/src/i18n.ts).`);
  }
}

// ---------------------------------------------------------------------------------------------
// --status: coverage per language
// ---------------------------------------------------------------------------------------------
if (args.has('--status')) {
  const rows = LOCALES.filter((l) => l !== 'en').map((lang) => {
    let total = 0;
    let done = 0;
    let unreviewed = 0;
    for (const u of units) {
      if (!u.en) continue;
      const keys = Object.keys(u.en);
      total += keys.length;
      const tr = u.translations?.[lang] ?? {};
      done += keys.filter((k) => typeof tr[k] === 'string').length;
      unreviewed += (tr['@@unreviewed'] ?? []).length;
    }
    return { lang, total, done, unreviewed };
  });
  console.log('language  translated            unreviewed (machine)');
  for (const r of rows) console.log(`${r.lang.padEnd(9)} ${String(r.done).padStart(5)} / ${String(r.total).padEnd(5)} ${((100 * r.done) / Math.max(1, r.total)).toFixed(1).padStart(5)}%   ${r.unreviewed}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// Hard-coded interface text (web): counted per file, held to i18n.baseline.json
// ---------------------------------------------------------------------------------------------
const TEXT_ATTRS = new Set(['aria-label', 'label', 'title', 'placeholder', 'description', 'content', 'hint', 'alt', 'heading', 'tooltip', 'confirmLabel', 'disabledReason']);
/** Proper names that read the same in every language. */
const PROPER = /^(Freero|GitHub|GitLab|Jira|Linear|Asana|Trello|Slack|Microsoft Teams|Teams|Claude|ChatGPT|Google|Figma|Miro|Notion|Zoom|Webex|Excel|PowerPoint|Visio|Mermaid|Markdown|CSV|PDF|PNG|SVG|JSON|URL|API|MCP|OAuth|SSO|SAML|SCIM|OK|ID|AI|Azure DevOps|Monday|ClickUp|Excalidraw|YouTube|Vimeo|Loom|Lucid|Lucidchart|draw\.io|Freero AI)$/;
const isText = (s) => {
  const v = s.replace(/\s+/g, ' ').trim();
  return /\p{L}{2,}/u.test(v) && !PROPER.test(v) && !/^(https?:|mailto:|\/|#|\.|fr-|var\(|Mod\+|Shift\+|Alt\+)/.test(v);
};
const SKIP_FILES = /^(app\/analytics\/runtime\.ts|app\/pwa\/sw\.ts|ui\/i18n\.ts|app\/i18n\/.*|features\/templates\/lib\/(catalog|specs|spec)\/.*|features\/templates\/lib\/kit\.ts)$/;

function hardCoded(file) {
  const src = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let n = 0;
  const visit = (node) => {
    if (ts.isJsxText(node) && isText(node.text)) n++;
    else if (ts.isJsxAttribute(node) && node.initializer && TEXT_ATTRS.has(node.name.getText(sf))) {
      const init = node.initializer;
      const lit = ts.isStringLiteral(init) ? init : ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression) || ts.isTemplateExpression(init.expression)) ? init.expression : null;
      const text = lit && (ts.isTemplateExpression(lit) ? lit.head.text + lit.templateSpans.map((s) => s.literal.text).join(' ') : lit.text);
      if (text && isText(text) && /\s|^[\p{Lu}]/u.test(text.trim())) n++;
    } else if (ts.isCallExpression(node)) {
      const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ts.isIdentifier(node.expression) ? node.expression.text : '';
      const a = node.arguments[0];
      if (callee === 'notify' && a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) || ts.isTemplateExpression(a))) n++;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return n;
}

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
const now = {};
for (const f of webFiles.filter(isSource)) {
  const r = path.relative(WEB, f).split(path.sep).join('/');
  if (SKIP_FILES.test(r)) continue;
  const n = hardCoded(f);
  if (n) now[rel(f)] = n;
}
if (args.has('--update-baseline')) {
  const next = {};
  for (const [f, n] of Object.entries(now).sort()) next[f] = Math.min(n, baseline[f] ?? n);
  fs.writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
  for (const f of Object.keys(baseline)) delete baseline[f];
  Object.assign(baseline, next);
  console.log(`i18n: baseline has ${Object.keys(next).length} files, ${Object.values(next).reduce((a, b) => a + b, 0)} strings.`);
}
let lower = 0;
for (const [f, n] of Object.entries(now)) {
  const allowed = baseline[f] ?? 0;
  if (n > allowed)
    errors.push(
      `${f}  has ${n} hard-coded interface string(s)${allowed ? ` (baseline ${allowed})` : ''}. Put new text in the unit's locales/en.json and show it with t('key') from its messages.ts (npm run i18n:extract -- ${f} does it for you); proper names can be written {'Name'}.`,
    );
  else if (n < allowed) lower++;
}
for (const f of Object.keys(baseline)) if (!(f in now)) lower++;

if (errors.length) {
  console.error(`check:i18n: ${errors.length} problem(s)\n`);
  for (const e of errors) console.error('  ' + e);
  console.error('\nSee docs/design/i18n.md.');
  process.exit(1);
}
console.log(`check:i18n: ${units.length} catalogues hold; ${Object.values(now).reduce((a, b) => a + b, 0)} hard-coded strings left in ${Object.keys(now).length} files${lower ? ` (${lower} below their baseline: npm run check:i18n -- --update-baseline)` : ''}.`);

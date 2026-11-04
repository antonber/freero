#!/usr/bin/env node
// Moves hard-coded interface text into catalogues (docs/design/i18n.md). Run:
//
//   npm run i18n:extract -- apps/web/src/features/voting [more files or folders…]
//
// For each file it wraps, in its unit's `t()` (adding the unit's messages.ts and locales/en.json
// when missing):
//   - JSX text, merged with the string / number expressions around it into one message
//     (`Delete {name}?`), plural conditionals (`n === 1 ? 'vote' : 'votes'`) becoming ICU plurals;
//   - string, template and conditional literals in interface props and attributes (label, title,
//     aria-label, placeholder, description …) and in notify() / setError() / confirm() …;
//   - sentence-like literals returned or passed elsewhere (two words or more, capitalised).
// Board content (templates' specs, outline.ts, feature manifests) is left alone. It uses the type
// checker, so only string / number expressions join a message. Review the diff: it is a codemod.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const WEB = path.join(ROOT, 'apps/web/src');
const slash = (p) => p.split(path.sep).join('/');

// ---- which strings ----------------------------------------------------------------------------
const ATTRS = new Set([
  'aria-label', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'aria-placeholder', 'label', 'title', 'placeholder', 'description', 'content',
  'hint', 'docTitle', 'text', 'sub', 'note', 'alt', 'body', 'confirmLabel', 'cancelLabel', 'empty', 'emptyLabel', 'verb', 'error',
  'heading', 'subtitle', 'message', 'tooltip', 'caption', 'noun', 'of', 'disabledReason', 'actionLabel', 'submitLabel', 'emptyText',
  'loadingLabel', 'summary', 'prompt', 'question', 'intro', 'outro', 'legend', 'help', 'detail', 'details', 'lead', 'what', 'why',
]);
const PROPS = new Set([
  'label', 'title', 'description', 'hint', 'text', 'disabledReason', 'body', 'message', 'heading', 'placeholder', 'sub', 'doc',
  'done', 'failed', 'working', 'doneBody', 'submit', 'intro', 'say', 'needs', 'question', 'next', 'one', 'many', 'other', 'noun',
  'commenter', 'editor', 'viewer', 'owner', 'coowner', 'guest', 'member', 'admin', 'none', 'error', 'empty', 'emptyLabel', 'confirmLabel', 'cancelLabel', 'tooltip', 'subtitle',
  'summary', 'caption', 'actionLabel', 'submitLabel', 'emptyText', 'ariaLabel', 'shortLabel', 'longLabel', 'help', 'detail', 'details',
  'lead', 'what', 'why', 'blurb', 'tagline', 'warning', 'notice', 'reason', 'explanation', 'cta',
  'singular', 'plural', 'verb', 'prompt', 'outro', 'legend', 'menuLabel', 'tip', 'note',
]);
const CALLS = new Set([
  'notify', 'setError', 'setInviteError', 'setMessage', 'setStatus', 'setNotice', 'setInfo', 'setHint', 'setWarning', 'announce',
  'confirm', 'alert', 'prompt', 'fail', 'act', 'errorText', 'setSaved', 'setDone', 'setProblem', 'say', 'toast', 'setFeedback',
]);
/** Callees whose string arguments are never interface text. */
const NEVER_CALLS = new Set([
  'log', 'warn', 'error', 'info', 'debug', 'trace', 'Error', 'TypeError', 'RangeError', 'querySelector', 'querySelectorAll', 'closest',
  'getAttribute', 'setAttribute', 'hasAttribute', 'removeAttribute', 'startsWith', 'endsWith', 'includes', 'indexOf', 'matchMedia',
  'test', 'replace', 'replaceAll', 'split', 'get', 'has', 'delete', 'getItem', 'setItem', 'removeItem', 'addEventListener',
  'removeEventListener', 'createElement', 'createElementNS', 'getElementById', 'runCommand', 'collection', 'openPanel', 'closePanel',
  'openDock', 'useCallback', 'useMemo', 'useRef', 'require', 'import', 'fetch', 'request', 'navigate', 'postMessage', 'dispatchEvent',
  'getPropertyValue', 'setProperty', 'defineFeature', 'match', 'matchAll', 'exec', 'localeCompare', 'parse', 'stringify', 'encodeURIComponent',
  'S', 'cell', 'rowCell', 'getElementsByTagName', 'getElementsByTagNameNS', 'kids', 't', 'tr',
]);

const hasLetter = (s) => /\p{L}/u.test(s);
const codeish = (s) =>
  /^(https?:|mailto:|data:|\/|#|\.|var\(|fr-|--|@)/.test(s.trim()) ||
  /^\s*[MmLlCcQqAaHhVvZz]\s*(-?[\d.]|x\b|,)/.test(s) || // SVG path data
  /(^|\s)x(px|%)?$/.test(s.trim()) && !/\p{L}{2,}/u.test(s.replace(/ x /g, ' ')) || // just a number and a unit
  PROPER.test(s.trim()) ||
  /^\s*\((min|max|prefers|hover|pointer|orientation)[a-z-]*\s*:/.test(s) || // media queries
  /[{}<>=\\]|\$\(|=>|\bfunction\b/.test(s) ||
  /[\w-]+:[^\s;]+;|^\s*[\w-]+\s*:\s*[^;]+;\s*[\w-]+\s*:/.test(s) || // CSS declarations
  /^[A-Z0-9_]+$/.test(s.trim()) ||
  /^[a-z][a-zA-Z0-9]*([.:/-][a-zA-Z0-9]+)+$/.test(s.trim()) || // ids, keys, mime types
  /^(Mod|Shift|Alt|Ctrl|Meta|Arrow|Escape|Enter|Tab|Backspace|Delete)\b[+A-Za-z]*$/.test(s.trim());
/** Interface text in a place made for it (a label prop): has a letter, isn't code. */
const human = (s) => hasLetter(s) && !codeish(s) && (/\s/.test(s.trim()) || /^[\p{Lu}]/u.test(s.trim()) || /[^\x00-\x7F]/.test(s));
const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·', times: '×', rarr: '→', larr: '←', copy: '©' };
/** JSX text as React renders it: entities decoded. */
const decodeJsx = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m));
/** Interface text anywhere: a capitalised phrase of two real words or more (placeholders aside). */
const sentence = (s) => {
  const plain = s.replace(/ x /g, ' ').trim();
  return hasLetter(plain) && !codeish(s) && /^[\p{Lu}“"‘(¿¡]/u.test(plain) && /\p{L}{2,}[^\p{L}]+\p{L}{2,}/u.test(plain);
};
/** Names that read the same in every language. */
const PROPER = /^(Freero|freero|GitHub|GitLab|Jira|Linear|Asana|Trello|Slack|Microsoft Teams|Teams|Claude|ChatGPT|Google|Figma|Miro|Notion|Zoom|Excel|PowerPoint|Visio|Mermaid|Markdown|CSV|PDF|PNG|SVG|JSON|OK|Excalidraw|C\+\+|C#)$/;

// ---- units ------------------------------------------------------------------------------------
/** The owned unit a file belongs to (its catalogue), or null. */
function unitOf(abs) {
  const r = slash(path.relative(WEB, abs)).split('/');
  if (r[0] === 'features' && r.length > 2) return `features/${r[1]}`;
  if (r[0] === 'app' && r[1] === 'pages' && r.length > 3) return `app/pages/${r[2]}`;
  if (r[0] === 'app') return 'app';
  if (r[0] === 'engine') return 'engine';
  if (r[0] === 'ui') return 'ui';
  return null;
}

function skipFile(abs) {
  const r = slash(path.relative(WEB, abs));
  if (!/\.(ts|tsx)$/.test(r) || /\.test\.tsx?$/.test(r) || r.endsWith('.d.ts')) return true;
  if (/^features\/[^/]+\/(feature|outline)\.ts$/.test(r)) return true; // manifests; outline.ts runs on the server [W13]
  if (/^features\/[^/]+\/messages\.ts$/.test(r) || /(^|\/)messages\.ts$/.test(r)) return true;
  if (/^features\/templates\/lib\/(catalog|specs|spec)\//.test(r) || r === 'features/templates/lib/kit.ts') return true; // template content
  if (r.startsWith('app/i18n/') || r === 'ui/i18n.ts') return true;
  if (r === 'app/analytics/runtime.ts' || r === 'app/pwa/sw.ts') return true; // built on their own, without imports
  if (r === 'features/templates/lib/gate.ts' || r === 'app/problems/diagnostics.ts') return true; // operators' / authors' text
  if (/^features\/templates\/lib\/(types|Preview|palette)\.tsx?$/.test(r)) return true; // the marketing site builds from these: no @ui
  if (outlineClosure().has(slash(abs).toLowerCase())) return true; // loaded by an outline.ts, which runs on the server [W13]
  if (r.startsWith('engine/store/')) return true;
  return false;
}

/** Every file an outline.ts loads at runtime (it must stay pure: no messages.ts there). */
let closure = null;
function outlineClosure() {
  if (closure) return closure;
  closure = new Set();
  const fdir = path.join(WEB, 'features');
  for (const f of fs.readdirSync(fdir)) {
    const queue = [path.join(fdir, f, 'outline.ts')].filter((x) => fs.existsSync(x));
    while (queue.length) {
      const file = queue.pop();
      const key = slash(file).toLowerCase();
      if (closure.has(key)) continue;
      closure.add(key);
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:^|\n)\s*(import|export)\s+(type\s+)?[^'"]*?from\s+['"](\.[^'"]+)['"]/g)) {
        if (m[2]) continue;
        let abs = path.resolve(path.dirname(file), m[3]);
        for (const ext of ['', '.ts', '.tsx', '/index.ts']) {
          if (fs.existsSync(abs + ext) && fs.statSync(abs + ext).isFile()) {
            abs = abs + ext;
            break;
          }
        }
        if (fs.existsSync(abs)) queue.push(abs);
      }
    }
  }
  return closure;
}

// ---- catalogues -------------------------------------------------------------------------------
const catalogs = new Map(); // unit -> { file, data, dirty }
function catalog(unit) {
  let c = catalogs.get(unit);
  if (!c) {
    const file = path.join(WEB, unit, 'locales/en.json');
    c = { file, data: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}, dirty: false, added: new Set() };
    catalogs.set(unit, c);
  }
  return c;
}

function keyFor(unit, message, nameText = message) {
  const c = catalog(unit);
  for (const [k, v] of Object.entries(c.data)) if (v === message) return k;
  let named = nameText;
  // Plurals / selects read as their `other` case.
  for (let i = 0; i < 5; i++) named = named.replace(/\{\w+, (?:plural|select|selectordinal),((?:\s*[=\w]+\s*\{[^{}]*\})+)\s*\}/g, (m, opts) => /\{([^{}]*)\}\s*$/.exec(opts)[1]);
  const plain = named
    .replace(/#/g, ' n ')
    .replace(/\{(\w+)\}/g, ' $1 ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const words = plain.split(/\s+/).filter(Boolean).slice(0, 5);
  let base = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
  base = base.normalize('NFKD').replace(/[^\w]/g, '') || 'text';
  if (/^\d/.test(base)) base = `n${base}`;
  if (base.length > 40) base = base.slice(0, 40);
  let key = base;
  for (let i = 2; key in c.data; i++) key = `${base}${i}`;
  c.data[key] = message;
  c.added.add(key);
  c.dirty = true;
  return key;
}

// ICU escaping of literal text.
// An apostrophe is literal unless it precedes { } # or another ' (ICU's optional quoting), so only
// those (and one at the very end, which a following {arg} would turn into a quote) are doubled.
const icuText = (s, inPlural = false) => {
  let out = s.replace(/'(?=['{}#]|$)/g, "''").replace(/[{}]/g, (m) => `'${m}'`);
  if (inPlural) out = out.replace(/#/g, "'#'");
  return out;
};

// ---- the program ------------------------------------------------------------------------------
function program() {
  const configPath = path.join(ROOT, 'apps/web/tsconfig.json');
  const cfg = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, path.dirname(configPath));
  return ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, noEmit: true } });
}

function collectTargets(args) {
  const out = [];
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) for (const e of fs.readdirSync(p)) walk(path.join(p, e));
    else if (!skipFile(p)) out.push(path.resolve(p));
  };
  for (const a of args) walk(path.resolve(ROOT, a));
  return out;
}

// ---- per file ---------------------------------------------------------------------------------
function processFile(sf, checker, unit) {
  const src = sf.text;
  const edits = [];
  const declaresT = new Set();
  // Names declared anywhere in the file (a local `t` would shadow the import).
  const visitDecl = (n) => {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isFunctionDeclaration(n) || ts.isBindingElement(n)) && n.name && ts.isIdentifier(n.name)) declaresT.add(n.name.text);
    if (ts.isImportSpecifier(n)) declaresT.add(n.name.text);
    ts.forEachChild(n, visitDecl);
  };
  visitDecl(sf);
  // A file that already shows its unit's messages keeps the name it imports them under.
  const existing = /import\s*\{\s*t(?:\s+as\s+(\w+))?\s*\}\s*from\s*['"][^'"]*\bmessages['"]/.exec(src);
  const T = existing ? existing[1] ?? 't' : declaresT.has('t') ? (declaresT.has('tr') ? 'tx' : 'tr') : 't';

  const isTextual = (e) => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e);
  const strip = (e) => {
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) && e.type.kind !== ts.SyntaxKind.TypeReference) e = e.expression;
    return e;
  };
  const isStringish = (e) => {
    const type = checker.getTypeAtLocation(e);
    if (type.flags & ts.TypeFlags.Any) return false;
    const ok = (ty) => !!(ty.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.Undefined | ts.TypeFlags.Null));
    return type.isUnion() ? type.types.every(ok) && type.types.some((t) => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null))) : ok(type) && !(type.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null));
  };
  const isNumberish = (e) => {
    const type = checker.getTypeAtLocation(e);
    return !!(type.flags & ts.TypeFlags.NumberLike);
  };

  // Variable names for expressions in one message.
  const varName = (e, used) => {
    e = strip(e);
    let base = 'value';
    if (ts.isIdentifier(e)) base = e.text;
    else if (ts.isPropertyAccessExpression(e)) base = e.name.text;
    else if (ts.isCallExpression(e)) {
      const callee = ts.isPropertyAccessExpression(e.expression) ? e.expression.name.text : ts.isIdentifier(e.expression) ? e.expression.text : 'value';
      base = /^(format|relative|plural|count)/i.test(callee) || callee === 'String' || callee === 'toLocaleString' ? 'value' : callee;
      if (ts.isPropertyAccessExpression(e.expression) && ['toLocaleString', 'toFixed', 'toString', 'trim', 'join', 'toLowerCase'].includes(callee)) {
        const inner = strip(e.expression.expression);
        if (ts.isIdentifier(inner)) base = inner.text;
        else if (ts.isPropertyAccessExpression(inner)) base = inner.name.text;
        else if (ts.isElementAccessExpression(inner) && ts.isIdentifier(inner.argumentExpression)) base = inner.argumentExpression.text;
      }
    } else if (ts.isElementAccessExpression(e)) base = ts.isIdentifier(e.expression) ? e.expression.text : 'value';
    else if (ts.isPropertyAccessExpression(e) === false && e.kind === ts.SyntaxKind.ThisKeyword) base = 'value';
    base = base.replace(/[^\w]/g, '') || 'value';
    if (/^[A-Z_]+$/.test(base)) base = base.toLowerCase();
    let name = base;
    for (let i = 2; used.has(name) && used.get(name) !== e.getText(sf); i++) name = `${base}${i}`;
    used.set(name, e.getText(sf));
    return name;
  };

  /** `n === 1 ? A : B` (and !== 1 / > 1 / < 2) → { countExpr, one, other } */
  const pluralConditional = (e) => {
    e = strip(e);
    if (!ts.isConditionalExpression(e)) return null;
    const c = strip(e.condition);
    if (!ts.isBinaryExpression(c)) return null;
    const op = c.operatorToken.kind;
    const lit = (x) => ts.isNumericLiteral(strip(x)) ? Number(strip(x).text) : null;
    let count = null;
    let singularFirst = null;
    let zeroSingular = false;
    if (lit(c.right) === 1 && (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken)) [count, singularFirst] = [c.left, true];
    else if (lit(c.right) === 1 && (op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken)) [count, singularFirst] = [c.left, false];
    else if (lit(c.right) === 1 && op === ts.SyntaxKind.GreaterThanToken) [count, singularFirst, zeroSingular] = [c.left, false, true];
    else if (lit(c.right) === 2 && op === ts.SyntaxKind.LessThanToken) [count, singularFirst, zeroSingular] = [c.left, true, true];
    else return null;
    const a = strip(e.whenTrue);
    const b = strip(e.whenFalse);
    if (!isTextual(a) || !isTextual(b)) return null;
    return { count, one: singularFirst ? a : b, other: singularFirst ? b : a, zeroSingular };
  };

  /**
   * Builds an ICU message from pieces: { text } | { expr } | { plural: {count, one, other} }.
   * Returns { message, vars: [[name, exprText]] } or null when there's no text in it.
   */
  const build = (pieces) => {
    const used = new Map();
    const vars = new Map();
    const exprVar = (e) => {
      const name = varName(e, used);
      vars.set(name, exprSource(e));
      return name;
    };
    const textual = (e, inPlural) => {
      if (e.icu !== undefined) return e.icu;
      e = strip(e);
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return icuText(e.text, inPlural);
      let out = icuText(e.head.text, inPlural);
      for (const span of e.templateSpans) out += `{${exprVar(span.expression)}}` + icuText(span.literal.text, inPlural);
      return out;
    };
    if (pieces.filter((p) => p.plural).length > 1) {
      for (let i = 0; i < pieces.length; i++) {
        const pl = pieces[i].plural;
        const prev = pieces[i - 1];
        if (!pl || !prev || prev.text === undefined) continue;
        const lit = (x) => (x.icu !== undefined ? null : ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x) ? x.text : null);
        const one = lit(pl.one);
        const other = lit(pl.other);
        if (one === null || other === null) continue;
        const suffix = /\p{L}+$/u.exec(prev.text);
        const word = suffix && one.length <= 3 && other.length <= 4 ? suffix[0] : '';
        if (!word && !/ $/.test(prev.text)) continue;
        prev.text = prev.text.slice(0, prev.text.length - word.length);
        let lead = '';
        const before = pieces[i - 2];
        if (/ $/.test(prev.text) && before?.expr && strip(before.expr).getText(sf) === strip(pl.count).getText(sf)) {
          prev.text = prev.text.slice(0, -1);
          before.drop = true;
          lead = '# ';
        }
        if (!word && !lead) continue;
        pl.one = { icu: lead + icuText(word + one, true) };
        pl.other = { icu: lead + icuText(word + other, true) };
      }
      pieces = pieces.filter((p) => !p.drop);
    }
    const plurals = pieces.filter((p) => p.plural);
    const render = (branch) =>
      pieces
        .map((p) => {
          if (p.text !== undefined) return icuText(p.text, branch !== null);
          if (p.expr) return `{${exprVar(p.expr)}}`;
          if (p.plural) {
            if (branch !== null && p === plurals[0]) return textual(branch === 'one' ? p.plural.one : p.plural.other, true);
            const n = exprVar(p.plural.count);
            const zero = p.plural.zeroSingular ? `=0 {${textual(p.plural.one, true)}} ` : '';
            return `{${n}, plural, ${zero}one {${textual(p.plural.one, true)}} other {${textual(p.plural.other, true)}}}`;
          }
          return '';
        })
        .join('');
    let message;
    if (plurals.length === 1) {
      const n = exprVar(plurals[0].plural.count);
      const zero = plurals[0].plural.zeroSingular ? `=0 {${render('one')}} ` : '';
      message = `{${n}, plural, ${zero}one {${render('one')}} other {${render('other')}}}`;
    } else message = render(null);
    const plain = message.replace(/\{[^{}]*\}/g, '');
    if (!hasLetter(plain) && !plurals.length) return null;
    const nameText = plurals.length === 1 ? render('other') : message;
    return { message, vars, nameText };
  };

  /** An interpolated expression's source, with the text leaves of its conditionals / fallbacks translated. */
  const exprSource = (e) => {
    const x = strip(e);
    const leaf = (l) => {
      const y = strip(l);
      if (isTextual(y)) {
        const txt = ts.isTemplateExpression(y) ? y.head.text + y.templateSpans.map((sp) => ' x ' + sp.literal.text).join('') : y.text;
        if (hasLetter(txt) && !codeish(txt)) {
          const b = build(piecesOf(y));
          if (b) return call(b);
        }
      }
      if (ts.isConditionalExpression(y) || (ts.isBinaryExpression(y) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(y.operatorToken.kind))) return `(${exprSource(y)})`;
      return l.getText(sf);
    };
    if (ts.isConditionalExpression(x)) return `${x.condition.getText(sf)} ? ${leaf(x.whenTrue)} : ${leaf(x.whenFalse)}`;
    if (ts.isBinaryExpression(x) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(x.operatorToken.kind))
      return `${x.left.getText(sf)} ${x.operatorToken.getText(sf)} ${leaf(x.right)}`;
    return e.getText(sf);
  };

  const call = (built) => {
    const key = keyFor(unit, built.message, built.nameText);
    if (!built.vars.size) return `${T}('${key}')`;
    const vars = [...built.vars].map(([n, text]) => (n === text ? n : `${n}: ${text}`));
    return `${T}('${key}', { ${vars.join(', ')} })`;
  };

  /** A textual expression (literal, template, plural conditional) → piece list. */
  const piecesOf = (e) => {
    e = strip(e);
    const pc = pluralConditional(e);
    if (pc) return [{ plural: pc }];
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [{ text: e.text }];
    if (ts.isTemplateExpression(e)) {
      const out = [{ text: e.head.text }];
      for (const span of e.templateSpans) {
        const inner = strip(span.expression);
        const ipc = pluralConditional(inner);
        if (ipc) out.push({ plural: ipc });
        else out.push({ expr: span.expression });
        out.push({ text: span.literal.text });
      }
      return out;
    }
    return null;
  };

  const handled = new Set();
  const replaceExpr = (e, test) => {
    // Conditionals / logical fallbacks: replace each textual leaf (unless the whole is a plural).
    const s = strip(e);
    if (handled.has(s)) return;
    const pcs = pluralConditional(s);
    if (pcs) {
      const branchText = (x) => (ts.isTemplateExpression(x) ? x.head.text + x.templateSpans.map((sp) => ' x ' + sp.literal.text).join('') : x.text);
      if (!test(branchText(pcs.one)) && !test(branchText(pcs.other))) return;
      const built = build(piecesOf(s));
      if (built) {
        edits.push([s.getStart(sf), s.getEnd(), call(built)]);
        handled.add(s);
      }
      return;
    }
    if (ts.isConditionalExpression(s)) {
      replaceExpr(s.whenTrue, test);
      replaceExpr(s.whenFalse, test);
      return;
    }
    if (ts.isBinaryExpression(s) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(s.operatorToken.kind)) {
      if (s.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) replaceExpr(s.left, test);
      replaceExpr(s.right, test);
      return;
    }
    if (!isTextual(s)) return;
    const staticText = ts.isTemplateExpression(s) ? s.head.text + s.templateSpans.map((x) => ' x ' + x.literal.text).join('') : s.text;
    if (!test(staticText)) return;
    const built = build(piecesOf(s));
    if (!built) return;
    handled.add(s);
    const isAttrValue = ts.isJsxAttribute(e.parent) && e.parent.initializer === e;
    edits.push([s.getStart(sf), s.getEnd(), isAttrValue ? `{${call(built)}}` : call(built)]);
  };

  const inType = (n) => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isTypeNode(p) || ts.isEnumDeclaration(p) || ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true;
      if (ts.isAsExpression(p) && p.type.getText(sf) === 'const') return true;
      if (ts.isSatisfiesExpression?.(p)) return true;
    }
    return false;
  };

  const jsxRuns = (parent) => {
    const tag = ts.isJsxElement(parent) ? parent.openingElement.tagName.getText(sf) : '';
    if (/^(code|pre|kbd|Kbd|samp|text|tspan|textPath)$/.test(tag)) return;
    const kids = parent.children;
    let run = [];
    const flush = () => {
      if (!run.some((k) => ts.isJsxText(k) && hasLetter(k.text))) {
        run = [];
        return;
      }
      // Trim whitespace-only text at both ends; keep same-line spaces as {' '}.
      const pieces = [];
      for (const k of run) {
        if (ts.isJsxText(k)) pieces.push({ text: decodeJsx(k.text), jsx: true });
        else {
          const ex = strip(k.expression);
          const pc = pluralConditional(ex);
          if (pc) pieces.push({ plural: pc });
          else if (ts.isStringLiteral(ex) || ts.isNoSubstitutionTemplateLiteral(ex)) pieces.push({ text: ex.text });
          else pieces.push({ expr: k.expression });
        }
      }
      // JSX whitespace rules: lines are trimmed and joined with one space; whitespace with a
      // newline at either end disappears.
      const norm = (s) => {
        const lines = s.split(/\r?\n/);
        if (lines.length === 1) return s;
        return lines
          .map((l, i) => (i === 0 ? l.replace(/\s+$/, '') : i === lines.length - 1 ? l.replace(/^\s+/, '') : l.trim()))
          .filter((l, i) => l.length || i === 0 || i === lines.length - 1)
          .join(' ');
      };
      for (const p of pieces) if (p.jsx) p.text = norm(p.text);
      let lead = '';
      let trail = '';
      const first = pieces[0];
      const last = pieces[pieces.length - 1];
      if (first.jsx) {
        const raw = run[0].text;
        const m = /^\s*/.exec(first.text)[0];
        if (m && !/\n/.test(raw.slice(0, raw.length - raw.trimStart().length))) lead = "{' '}";
        first.text = first.text.trimStart();
      }
      if (last.jsx) {
        const raw = run[run.length - 1].text;
        const m = /\s*$/.exec(last.text)[0];
        if (m && !/\n/.test(raw.slice(raw.trimEnd().length))) trail = "{' '}";
        last.text = last.text.trimEnd();
      }
      const textOnly = pieces.filter((x) => x.text !== undefined).map((x) => x.text).join(' ');
      const keyWord = /^\s*(Delete|Enter|Escape|Tab|Backspace)\s*$/.test(textOnly); // a button's label, not a key name
      const built = codeish(textOnly) && !keyWord && !pieces.some((x) => x.plural) ? null : build(pieces);
      if (built) {
        const start = run[0].getStart(sf, false) ?? run[0].pos;
        edits.push([run[0].pos, run[run.length - 1].end, `${lead}{${call(built)}}${trail}`]);
        void start;
        for (const k of run) if (!ts.isJsxText(k)) handled.add(strip(k.expression));
      }
      run = [];
    };
    for (const k of kids) {
      if (ts.isJsxText(k)) {
        run.push(k);
        continue;
      }
      if (ts.isJsxExpression(k) && k.expression && !k.dotDotDotToken) {
        const ex = strip(k.expression);
        const alreadyT = ts.isCallExpression(ex) && ts.isIdentifier(ex.expression) && ['t', 'tr', 'tx'].includes(ex.expression.text);
        if (!alreadyT && (pluralConditional(ex) || ts.isStringLiteral(ex) || ts.isNoSubstitutionTemplateLiteral(ex) || (!ts.isConditionalExpression(ex) && !ts.isBinaryExpression(ex) && !ts.isJsxElement(ex) && !ts.isJsxSelfClosingElement(ex) && !ts.isJsxFragment(ex) && !ts.isTemplateExpression(ex) && isStringish(ex)))) {
          run.push(k);
          continue;
        }
      }
      if (ts.isJsxExpression(k) && !k.expression) continue; // a comment
      flush();
    }
    flush();
  };

  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const callee = ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : ts.isIdentifier(n.expression) ? n.expression.text : '';
      if (callee === T || callee === 't') return; // already translated
    }
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) jsxRuns(n);
    if (ts.isJsxAttribute(n) && n.initializer) {
      const name = n.name.getText(sf);
      if (ATTRS.has(name)) {
        const init = n.initializer;
        if (ts.isStringLiteral(init)) replaceExpr(init, human);
        else if (ts.isJsxExpression(init) && init.expression) replaceExpr(init.expression, human);
      }
    }
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) && !handled.has(n) && !inType(n)) {
      // Climb through conditionals / parens / fallbacks to the position that decides.
      let top = n;
      let p = n.parent;
      while (p && (ts.isConditionalExpression(p) && p.condition !== top || ts.isParenthesizedExpression(p) || (ts.isBinaryExpression(p) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(p.operatorToken.kind) && p.right === top) || ts.isAsExpression(p))) {
        top = p;
        p = p.parent;
      }
      if (p && !(ts.isTemplateSpan(p))) {
        if (ts.isPropertyAssignment(p) && p.initializer === top) {
          const key = p.name.getText(sf).replace(/['"]/g, '');
          if (PROPS.has(key)) replaceExpr(top, human);
          else if (!/^[#'"\d]/.test(p.name.getText(sf))) replaceExpr(top, sentence);
        } else if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(top)) {
          const callee = ts.isPropertyAccessExpression(p.expression) ? p.expression.name.text : ts.isIdentifier(p.expression) ? p.expression.text : '';
          if (ts.isNewExpression(p)) {
            /* errors and other constructors: developer text */
          } else if (CALLS.has(callee)) replaceExpr(top, human);
          else if (!NEVER_CALLS.has(callee) && !/^use[A-Z]/.test(callee) && !(ts.isPropertyAccessExpression(p.expression) && ['console'].includes(p.expression.expression.getText(sf)))) replaceExpr(top, sentence);
        } else if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) {
          /* an attribute that isn't interface text (className, d, href …) */
        } else if (ts.isReturnStatement(p) || ts.isArrowFunction(p) || ts.isArrayLiteralExpression(p) || (ts.isVariableDeclaration(p) && p.initializer === top) || ts.isJsxExpression(p)) {
          replaceExpr(top, ts.isJsxExpression(p) && !ts.isJsxAttribute(p.parent) ? human : sentence);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  if (!edits.length) return null;
  // Apply from the end; drop edits nested in an earlier (outer) one.
  edits.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const kept = [];
  for (const e of edits) {
    const last = kept[kept.length - 1];
    if (last && e[0] < last[1]) continue;
    kept.push(e);
  }
  let out = src;
  for (const [s, e, text] of kept.reverse()) out = out.slice(0, s) + text + out.slice(e);
  // The import.
  const fileDir = path.dirname(sf.fileName);
  let rel = slash(path.relative(fileDir, path.join(WEB, unit, 'messages')));
  if (!rel.startsWith('.')) rel = `./${rel}`;
  const imp = T === 't' ? `import { t } from '${rel}';` : `import { t as ${T} } from '${rel}';`;
  if (!existing && !out.includes(imp)) {
    const imports = [...out.matchAll(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm)];
    if (imports.length) {
      const last = imports[imports.length - 1];
      const at = last.index + last[0].length;
      out = out.slice(0, at) + `\n${imp}` + out.slice(at);
    } else {
      // after a leading comment block
      const m = /^(\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*\n)*)/.exec(out);
      out = out.slice(0, m[0].length) + `${imp}\n` + out.slice(m[0].length);
    }
  }
  return { text: out, count: kept.length };
}

function ensureMessagesFile(unit) {
  const file = path.join(WEB, unit, 'messages.ts');
  if (fs.existsSync(file)) return;
  const from = unit === 'ui' ? "'./i18n'" : "'@ui'";
  fs.writeFileSync(
    file,
    `// This unit's interface text (docs/design/i18n.md): English in locales/en.json, translations beside it.\nimport { defineMessages } from ${from};\nimport en from './locales/en.json';\n\nexport const t = defineMessages('${unit}', en);\n`,
  );
}

// ---- main -------------------------------------------------------------------------------------
const args = process.argv.slice(2);
if (!args.length) {
  console.error('usage: npm run i18n:extract -- <files or folders under apps/web/src>…');
  process.exit(1);
}
const targets = new Set(collectTargets(args).map((f) => slash(f).toLowerCase()));
const prog = program();
const checker = prog.getTypeChecker();
let total = 0;
const results = [];
for (const sf of prog.getSourceFiles()) {
  if (!targets.has(slash(path.resolve(sf.fileName)).toLowerCase())) continue;
  const unit = unitOf(path.resolve(sf.fileName));
  if (!unit) continue;
  const r = processFile(sf, checker, unit);
  if (!r) continue;
  results.push([sf.fileName, r.text, unit]);
  total += r.count;
  console.log(`${String(r.count).padStart(4)}  ${slash(path.relative(ROOT, sf.fileName))}`);
}
for (const [file, text, unit] of results) {
  fs.writeFileSync(file, text);
  ensureMessagesFile(unit);
}
for (const [unit, c] of catalogs) {
  if (!c.dirty) continue;
  // A key made for an edit that a wider edit replaced is used nowhere: leave it out.
  const texts = results.filter((r) => r[2] === unit).map((r) => r[1]).join('\n');
  for (const k of c.added) if (!texts.includes(`('${k}'`)) delete c.data[k];
  fs.mkdirSync(path.dirname(c.file), { recursive: true });
  fs.writeFileSync(c.file, JSON.stringify(c.data, null, 2) + '\n');
  ensureMessagesFile(unit);
}
console.log(`${total} strings moved into catalogues.`);

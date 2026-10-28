// SCIM 2.0 filters (RFC 7644 §3.4.2.2) and attribute paths, evaluated against a resource's JSON
// representation. Covers what Okta and Entra ID send: `userName eq "x"`, `externalId eq "x"`,
// `displayName eq "x"`, `id eq "x" and members[value eq "y"]`, `emails[type eq "work"].value`,
// `active eq true`, `meta.lastModified gt "…"`, `pr`, `co`/`sw`/`ew`, `not (…)`, `and`/`or`,
// parentheses. Attribute names and string comparisons are case-insensitive (caseExact: false).

export class ScimFilterError extends Error {}

type Value = string | number | boolean | null;
export type Filter =
  | { kind: 'and' | 'or'; left: Filter; right: Filter }
  | { kind: 'not'; inner: Filter }
  | { kind: 'compare'; path: string[]; op: string; value: Value }
  | { kind: 'present'; path: string[] }
  | { kind: 'valuePath'; path: string[]; inner: Filter; sub: string[] | null; op: string | null; value: Value };

const OPS = new Set(['eq', 'ne', 'co', 'sw', 'ew', 'gt', 'ge', 'lt', 'le']);
const URN_RE = /^urn:ietf:params:scim:schemas:[a-z0-9:.]*?:(?:User|Group):/i;

type Token = { t: 'word' | 'string' | '(' | ')' | '[' | ']'; v: string };

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === '(' || c === ')' || c === '[' || c === ']') {
      out.push({ t: c, v: c });
      i++;
    } else if (c === '"') {
      let v = '';
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length) {
          v += s[i + 1];
          i += 2;
        } else v += s[i++];
      }
      if (s[i] !== '"') throw new ScimFilterError('Unterminated string in filter');
      i++;
      out.push({ t: 'string', v });
    } else {
      let v = '';
      while (i < s.length && !/[\s()[\]"]/.test(s[i])) v += s[i++];
      out.push({ t: 'word', v });
    }
  }
  return out;
}

/** "name.givenName" -> ['name', 'givenname'] (lower case, schema URN prefix dropped). */
export function attrPath(s: string): string[] {
  const p = s.replace(URN_RE, '');
  if (!/^[A-Za-z$][\w$-]*(\.[A-Za-z$][\w$-]*)?$/.test(p)) throw new ScimFilterError(`Bad attribute path "${s}"`);
  return p.toLowerCase().split('.');
}

export function parseFilter(input: string): Filter {
  if (input.length > 4096) throw new ScimFilterError('Filter is too long');
  const tokens = tokenize(input);
  let pos = 0;
  const peek = () => tokens[pos];
  const word = (w: string) => peek()?.t === 'word' && peek().v.toLowerCase() === w;
  const expect = (t: Token['t']) => {
    if (peek()?.t !== t) throw new ScimFilterError(`Expected "${t}" in filter`);
    pos++;
  };
  const value = (): Value => {
    const tok = tokens[pos++];
    if (!tok) throw new ScimFilterError('Missing value in filter');
    if (tok.t === 'string') return tok.v;
    if (tok.t !== 'word') throw new ScimFilterError('Bad value in filter');
    const l = tok.v.toLowerCase();
    if (l === 'true') return true;
    if (l === 'false') return false;
    if (l === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(tok.v)) return Number(tok.v);
    throw new ScimFilterError(`Bad value "${tok.v}" in filter`);
  };
  const op = (): string => {
    const tok = tokens[pos++];
    const o = tok?.t === 'word' ? tok.v.toLowerCase() : '';
    if (!OPS.has(o)) throw new ScimFilterError(`Unsupported operator "${tok?.v ?? ''}"`);
    return o;
  };
  function or(): Filter {
    let left = and();
    while (word('or')) {
      pos++;
      left = { kind: 'or', left, right: and() };
    }
    return left;
  }
  function and(): Filter {
    let left = unary();
    while (word('and')) {
      pos++;
      left = { kind: 'and', left, right: unary() };
    }
    return left;
  }
  function unary(): Filter {
    if (word('not')) {
      pos++;
      expect('(');
      const inner = or();
      expect(')');
      return { kind: 'not', inner };
    }
    if (peek()?.t === '(') {
      pos++;
      const inner = or();
      expect(')');
      return inner;
    }
    const tok = tokens[pos++];
    if (tok?.t !== 'word') throw new ScimFilterError('Expected an attribute in filter');
    const path = attrPath(tok.v);
    if (peek()?.t === '[') {
      pos++;
      const inner = or();
      expect(']');
      // `emails[type eq "work"].value eq "x"`: a sub-attribute after the brackets.
      const next = peek();
      if (next?.t === 'word' && next.v.startsWith('.')) {
        pos++;
        const sub = next.v.slice(1).toLowerCase().split('.');
        if (word('pr')) {
          pos++;
          return { kind: 'valuePath', path, inner, sub, op: 'pr', value: null };
        }
        const o = op();
        return { kind: 'valuePath', path, inner, sub, op: o, value: value() };
      }
      return { kind: 'valuePath', path, inner, sub: null, op: null, value: null };
    }
    if (word('pr')) {
      pos++;
      return { kind: 'present', path };
    }
    const o = op();
    return { kind: 'compare', path, op: o, value: value() };
  }
  const f = or();
  if (pos !== tokens.length) throw new ScimFilterError('Unexpected text after the filter');
  return f;
}

/** Case-insensitive own-key lookup. */
export function getKey(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  for (const [k, v] of Object.entries(obj)) if (k.toLowerCase() === key) return v;
  return undefined;
}

/** Every value at `path` (multi-valued attributes flattened). */
export function valuesAt(obj: unknown, path: string[]): unknown[] {
  let cur: unknown[] = [obj];
  for (const key of path) {
    const next: unknown[] = [];
    for (const c of cur) {
      const v = getKey(c, key);
      if (Array.isArray(v)) next.push(...v);
      else if (v !== undefined) next.push(v);
    }
    cur = next;
  }
  return cur;
}

function compare(actual: unknown, op: string, expected: Value): boolean {
  if (actual === null || actual === undefined) return op === 'eq' ? expected === null : op === 'ne' ? expected !== null : false;
  if (typeof actual === 'boolean' || typeof expected === 'boolean') {
    const a = typeof actual === 'string' ? actual.toLowerCase() === 'true' : actual;
    return op === 'eq' ? a === expected : op === 'ne' ? a !== expected : false;
  }
  if (typeof actual === 'number' && typeof expected === 'number') {
    switch (op) {
      case 'eq': return actual === expected;
      case 'ne': return actual !== expected;
      case 'gt': return actual > expected;
      case 'ge': return actual >= expected;
      case 'lt': return actual < expected;
      case 'le': return actual <= expected;
      default: return false;
    }
  }
  const a = String(actual).toLowerCase();
  const e = String(expected ?? '').toLowerCase();
  switch (op) {
    case 'eq': return a === e;
    case 'ne': return a !== e;
    case 'co': return a.includes(e);
    case 'sw': return a.startsWith(e);
    case 'ew': return a.endsWith(e);
    // Strings (dateTime included, ISO 8601) compare lexicographically.
    case 'gt': return a > e;
    case 'ge': return a >= e;
    case 'lt': return a < e;
    case 'le': return a <= e;
    default: return false;
  }
}

const present = (v: unknown) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);

export function matches(f: Filter, resource: unknown): boolean {
  switch (f.kind) {
    case 'and': return matches(f.left, resource) && matches(f.right, resource);
    case 'or': return matches(f.left, resource) || matches(f.right, resource);
    case 'not': return !matches(f.inner, resource);
    case 'present': return valuesAt(resource, f.path).some(present);
    case 'compare': {
      const vals = valuesAt(resource, f.path);
      if (f.op === 'ne') return vals.length === 0 ? f.value !== null : vals.every((v) => compare(v, 'ne', f.value));
      return vals.some((v) => compare(v, f.op, f.value));
    }
    case 'valuePath': {
      const elems = valuesAt(resource, f.path).filter((e) => matches(f.inner, e));
      if (!f.sub) return elems.length > 0;
      const subs = elems.flatMap((e) => valuesAt(e, f.sub!));
      return f.op === 'pr' ? subs.some(present) : subs.some((v) => compare(v, f.op!, f.value));
    }
  }
}

// SCIM PATCH (RFC 7644 §3.5.2) applied to a resource's JSON representation, as Okta and Entra ID
// send it: ops in any case ("Replace"), with or without `path`, values as booleans or as strings
// ("False"), paths like `active`, `name.givenName`, `emails[type eq "work"].value`, and
// `members[value eq "id"]`. The caller maps the patched representation back to its storage, so
// read-only and unknown attributes simply have no effect.
import { attrPath, getKey, matches, parseFilter, ScimFilterError, type Filter } from './filter';

export interface PatchOp {
  op: 'add' | 'replace' | 'remove';
  path: string | null;
  value: unknown;
}

export const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

/** Validates a PatchOp request body; throws ScimFilterError (→ 400 invalidSyntax) otherwise. */
export function readPatch(body: unknown): PatchOp[] {
  const ops = getKey(body, 'operations');
  if (!Array.isArray(ops) || ops.length === 0) throw new ScimFilterError('Operations must be a non-empty array');
  return ops.map((o) => {
    const op = String(getKey(o, 'op') ?? '').toLowerCase();
    if (op !== 'add' && op !== 'replace' && op !== 'remove') throw new ScimFilterError(`Unsupported op "${String(getKey(o, 'op'))}"`);
    const path = getKey(o, 'path');
    if (path !== undefined && typeof path !== 'string') throw new ScimFilterError('path must be a string');
    if (op === 'remove' && !path) throw new ScimFilterError('remove needs a path');
    return { op, path: path ? path : null, value: getKey(o, 'value') };
  });
}

export interface ParsedPath {
  attr: string;
  filter: Filter | null;
  sub: string | null;
}

/** `emails[type eq "work"].value` -> { attr: 'emails', filter, sub: 'value' }; `name.givenName` -> { attr: 'name', sub: 'givenname' }. */
export function parsePath(path: string): ParsedPath {
  const open = path.indexOf('[');
  if (open < 0) {
    const [attr, sub] = attrPath(path);
    return { attr, filter: null, sub: sub ?? null };
  }
  const close = path.lastIndexOf(']');
  if (close < open) throw new ScimFilterError(`Bad path "${path}"`);
  const [attr] = attrPath(path.slice(0, open));
  const rest = path.slice(close + 1);
  if (rest && !/^\.[A-Za-z][\w-]*$/.test(rest)) throw new ScimFilterError(`Bad path "${path}"`);
  return { attr, filter: parseFilter(path.slice(open + 1, close)), sub: rest ? rest.slice(1).toLowerCase() : null };
}

type Json = Record<string, unknown>;

/** The key of `obj` matching `lower` case-insensitively, or `lower` itself. */
const keyOf = (obj: Json, lower: string) => Object.keys(obj).find((k) => k.toLowerCase() === lower) ?? lower;

const MULTI = new Set(['emails', 'members', 'phonenumbers', 'addresses', 'groups']);

/** Applies the operations to a copy of `resource` and returns it. */
export function applyPatch(resource: Json, ops: PatchOp[]): Json {
  const r: Json = structuredClone(resource);
  for (const o of ops) {
    if (!o.path) {
      // No path: the value is an object of attributes to add / replace.
      if (o.op === 'remove' || !o.value || typeof o.value !== 'object' || Array.isArray(o.value)) throw new ScimFilterError('A patch without path needs an object value');
      for (const [k, v] of Object.entries(o.value as Json)) {
        const p = parsePath(k);
        setAt(r, p, v, o.op);
      }
      continue;
    }
    const p = parsePath(o.path);
    if (o.op === 'remove') removeAt(r, p, o.value);
    else setAt(r, p, o.value, o.op);
  }
  return r;
}

function setAt(r: Json, p: ParsedPath, value: unknown, op: 'add' | 'replace' | 'remove'): void {
  const key = keyOf(r, p.attr);
  if (p.filter) {
    const list = Array.isArray(r[key]) ? (r[key] as Json[]) : [];
    const hits = list.filter((e) => matches(p.filter!, e));
    if (hits.length) for (const h of hits) p.sub ? (h[keyOf(h, p.sub)] = value) : Object.assign(h, value as Json);
    else {
      // Nothing matched: add the element, taking `type eq "work"` style equalities from the filter.
      const el: Json = {};
      if (p.filter.kind === 'compare' && p.filter.op === 'eq') el[p.filter.path.join('.')] = p.filter.value;
      if (p.sub) el[p.sub] = value;
      else Object.assign(el, value as Json);
      list.push(el);
    }
    r[key] = list;
    return;
  }
  if (p.sub) {
    const parent = r[key] && typeof r[key] === 'object' && !Array.isArray(r[key]) ? (r[key] as Json) : {};
    parent[keyOf(parent, p.sub)] = value;
    r[key] = parent;
    return;
  }
  if (MULTI.has(p.attr)) {
    const incoming = Array.isArray(value) ? value : [value];
    const existing = op === 'add' && Array.isArray(r[key]) ? (r[key] as unknown[]) : [];
    // add appends (without duplicating the same `value`); replace sets the whole list.
    const seen = new Set(existing.map((e) => String(getKey(e, 'value') ?? JSON.stringify(e)).toLowerCase()));
    r[key] = [...existing, ...incoming.filter((e) => !seen.has(String(getKey(e, 'value') ?? JSON.stringify(e)).toLowerCase()))];
    return;
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && r[key] && typeof r[key] === 'object' && op === 'add') {
    r[key] = { ...(r[key] as Json), ...(value as Json) };
    return;
  }
  r[key] = value;
}

function removeAt(r: Json, p: ParsedPath, value: unknown): void {
  const key = keyOf(r, p.attr);
  if (p.filter) {
    const list = Array.isArray(r[key]) ? (r[key] as Json[]) : [];
    if (p.sub) for (const e of list.filter((x) => matches(p.filter!, x))) delete e[keyOf(e, p.sub)];
    else r[key] = list.filter((e) => !matches(p.filter!, e));
    return;
  }
  if (p.sub) {
    const parent = r[key];
    if (parent && typeof parent === 'object') delete (parent as Json)[keyOf(parent as Json, p.sub)];
    return;
  }
  // Entra: { op: "Remove", path: "members", value: [{ value: "id" }] } removes just those.
  if (MULTI.has(p.attr) && Array.isArray(value) && Array.isArray(r[key])) {
    const drop = new Set(value.map((v) => String(getKey(v, 'value') ?? '').toLowerCase()));
    r[key] = (r[key] as unknown[]).filter((e) => !drop.has(String(getKey(e, 'value') ?? '').toLowerCase()));
    return;
  }
  delete r[key];
}

/** SCIM booleans arrive as true/false or, from Entra, "True"/"False". */
export function scimBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string' && /^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  return null;
}

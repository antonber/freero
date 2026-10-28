// The object registry (KAI-147): one answer to "may this person do X with that object?" for every
// object type, and one batched resolver from addresses to permission-checked summaries.
//
// This module decides nothing itself. Each OWNING module registers its types from its init.ts
// (boards: 'board' and 'element', through members' resolveRole; templates: 'template';
// workspaces: 'workspace' and 'project') and keeps its own rules; the registry only routes a
// batch of refs to their owners and turns roles into actions. So the API, the MCP server, embeds,
// backlinks and search ask here, and a rule changed in its owner is changed for all of them.
import {
  formatObjectUri,
  MAX_RESOLVE_URIS,
  OBJECT_ACTIONS,
  objectKey,
  parseObjectUri,
  type ObjectAction,
  type ObjectRef,
  type ObjectSummary,
  type ObjectType,
  type ResolvedObject,
} from '@freero/shared';

/** Who is asking: an account id, or a guest id (a visitor on one board's link). */
export interface Actor {
  userId: string;
}

/**
 * Why access is asked for. 'open': the actor holds the address (a link in front of them), so a
 * board's link access counts, as on the board page. 'discover': listing things the actor did not
 * point at (backlinks, search): a board reached ONLY through its link counts just when the actor
 * has opened it before — otherwise an index would hand out the board ids its link protects.
 */
export type AccessPurpose = 'open' | 'discover';

export interface ObjectLookup {
  access: ObjectAction;
  /** Present when summaries were asked for. */
  summary?: ObjectSummary;
}

export interface ObjectTypeHandler {
  type: ObjectType;
  /**
   * What `actor` may do with each ref (keyed by objectKey), and its summary when `summaries`.
   * A ref missing from the result, like one the actor can't reach, is denied. Batched: the number
   * of queries must not grow with the number of refs.
   */
  lookup(actor: Actor, refs: ObjectRef[], opts: { purpose: AccessPurpose; summaries: boolean }): Promise<Map<string, ObjectLookup>>;
}

const handlers = new Map<ObjectType, ObjectTypeHandler>();

/** An owning module registers how its type is checked (from its init.ts). Re-registering replaces. */
export function registerObjectType(handler: ObjectTypeHandler): void {
  handlers.set(handler.type, handler);
}

const RANK: Record<ObjectAction, number> = Object.fromEntries(OBJECT_ACTIONS.map((a, i) => [a, i])) as Record<ObjectAction, number>;

/** True when `granted` covers `wanted` (manage ⊇ edit ⊇ comment ⊇ view). */
export const covers = (granted: ObjectAction | null | undefined, wanted: ObjectAction): boolean => !!granted && RANK[granted] >= RANK[wanted];

async function lookupAll(actor: Actor, refs: ObjectRef[], opts: { purpose: AccessPurpose; summaries: boolean }): Promise<Map<string, ObjectLookup>> {
  const byType = new Map<ObjectType, ObjectRef[]>();
  const seen = new Set<string>();
  for (const r of refs) {
    const k = objectKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    byType.set(r.type, [...(byType.get(r.type) ?? []), r]);
  }
  const out = new Map<string, ObjectLookup>();
  if (!actor.userId) return out;
  await Promise.all(
    [...byType].map(async ([type, list]) => {
      const h = handlers.get(type);
      if (!h) return;
      for (const [k, v] of await h.lookup(actor, list, opts)) if (seen.has(k)) out.set(k, v);
    }),
  );
  return out;
}

/** The strongest action `actor` may take on each ref (objectKey → action, or null). */
export async function accessOf(actor: Actor, refs: ObjectRef[], purpose: AccessPurpose = 'open'): Promise<Map<string, ObjectAction | null>> {
  const found = await lookupAll(actor, refs, { purpose, summaries: false });
  return new Map(refs.map((r) => [objectKey(r), found.get(objectKey(r))?.access ?? null]));
}

/** The one permission check: may `actor` do `action` with the object? */
export async function can(actor: Actor, action: ObjectAction, ref: ObjectRef, purpose: AccessPurpose = 'open'): Promise<boolean> {
  return covers((await accessOf(actor, [ref], purpose)).get(objectKey(ref)), action);
}

/** The refs `actor` may `action` (batched; order kept). */
export async function filterObjects<R extends ObjectRef>(actor: Actor, action: ObjectAction, refs: R[], purpose: AccessPurpose = 'open'): Promise<R[]> {
  const access = await accessOf(actor, refs, purpose);
  return refs.filter((r) => covers(access.get(objectKey(r)), action));
}

/** Summaries of the refs `actor` may see (objectKey → summary); the rest are absent. */
export async function summarizeObjects(actor: Actor, refs: ObjectRef[], purpose: AccessPurpose = 'open'): Promise<Map<string, ObjectSummary>> {
  const found = await lookupAll(actor, refs, { purpose, summaries: true });
  const out = new Map<string, ObjectSummary>();
  for (const [k, v] of found) if (v.summary && covers(v.access, 'view')) out.set(k, v.summary);
  return out;
}

/**
 * Addresses → what `actor` may know about each, in order, in one batch. An address the actor
 * can't see and one that leads nowhere read the same ('unavailable', nothing else), so content
 * carrying addresses never tells its readers whether a target exists or what it is called.
 */
export async function resolveObjects(actor: Actor, uris: readonly string[], origins: readonly string[] = []): Promise<ResolvedObject[]> {
  const list = uris.slice(0, MAX_RESOLVE_URIS);
  const refs = list.map((u) => (typeof u === 'string' ? parseObjectUri(u, origins) : null));
  const summaries = await summarizeObjects(
    actor,
    refs.filter((r): r is ObjectRef => r !== null),
  );
  return list.map((uri, i) => {
    const ref = refs[i];
    if (!ref) return { uri: String(uri), status: 'invalid' };
    const s = summaries.get(objectKey(ref));
    return s ? { uri: String(uri), status: 'ok', object: s } : { uri: String(uri), status: 'unavailable' };
  });
}

export { formatObjectUri };

// Search, object addresses and backlinks for a credential (KAI-151, KAI-227): the app's own
// operations (modules/search, modules/objects, modules/references) with the API's rules on top —
// the team's API switch and blocks per workspace, the downloads policy on board text (KAI-197),
// untrusted-content notices and the audit event. REST (/api/v1) and MCP both call these.
import { formatObjectUri, MAX_RESOLVE_URIS, parseObjectUri, type Backlink, type ResolvedObject, type SearchResponse } from '@freero/shared';
import { badRequest, notFound } from '../../platform/http';
import { consumeRateLimit } from '../../platform/rateLimit';
import { useInWorkspace } from '../apiauth/index';
import { boardReadPolicies } from '../boards/index';
import { appOrigins, resolveObjects } from '../objects/index';
import { backlinksOf } from '../references/index';
import { searchFor, type SearchQuery } from '../search/index';
import { withNotice, type ApiCall } from './service';

/**
 * Of these boards: the ones whose workspace lets this credential in (the team's API switch, its
 * blocks) and, with `content`, whose downloads policy lets the person take text out. Each
 * workspace is asked once per call.
 */
async function readable(call: ApiCall, boardIds: string[], content: boolean): Promise<Set<string>> {
  const policies = await boardReadPolicies(call.userId, boardIds);
  const allowed = new Map<string, boolean>();
  const out = new Set<string>();
  for (const [id, p] of policies) {
    if (!allowed.has(p.workspaceId))
      allowed.set(
        p.workspaceId,
        await useInWorkspace(call.cred, p.workspaceId).then(
          () => true,
          () => false,
        ),
      );
    if (allowed.get(p.workspaceId) && (!content || p.mayDownload)) out.add(id);
  }
  return out;
}

/**
 * Searches what the person may find, like the app — leaving out boards of workspaces that turned
 * the API off or blocked this credential, and boards whose downloads policy keeps their text from
 * the person (search results are board text).
 */
export async function searchContent(call: ApiCall, q: SearchQuery): Promise<SearchResponse & { notice: string }> {
  await consumeRateLimit('search', `cred:${call.cred.credentialId}`);
  const out = await searchFor({ userId: call.userId }, q, { allow: (ids) => readable(call, ids, true) });
  call.audit.metadata = { returned: out.hits.length };
  return withNotice(out);
}

/**
 * Addresses → what the person may know about each (the app's resolve). Objects on boards of a
 * workspace closed to this credential read 'unavailable'; an item on a board whose downloads
 * policy keeps its text from the person keeps its kind and board but loses its title (item text).
 */
export async function resolveForApi(call: ApiCall, uris: unknown): Promise<{ notice: string; objects: ResolvedObject[] }> {
  if (!Array.isArray(uris) || uris.some((u) => typeof u !== 'string')) throw badRequest('uris must be an array of strings');
  if (uris.length > MAX_RESOLVE_URIS) throw badRequest(`At most ${MAX_RESOLVE_URIS} addresses per call`);
  const origins = appOrigins(call.req);
  const resolved = await resolveObjects({ userId: call.userId }, uris as string[], origins);
  const boardOf = (o: ResolvedObject): string | null => {
    if (o.status !== 'ok') return null;
    const ref = parseObjectUri(o.uri, origins);
    // A doc (KAI-162) is a container like a board: its workspace's API switch applies the same way.
    return ref?.type === 'board' || ref?.type === 'doc' ? ref.id : ref?.type === 'element' ? ref.boardId : null;
  };
  const boards = [...new Set(resolved.map(boardOf).filter((b): b is string => !!b))];
  const [open, withText] = await Promise.all([readable(call, boards, false), readable(call, boards, true)]);
  const objects = resolved.map((o): ResolvedObject => {
    const b = boardOf(o);
    if (!b || o.status !== 'ok') return o;
    if (!open.has(b)) return { uri: o.uri, status: 'unavailable' };
    if (o.object.type === 'element' && !withText.has(b)) return { ...o, object: { ...o.object, title: '' } };
    return o;
  });
  call.audit.metadata = { resolved: objects.filter((o) => o.status === 'ok').length };
  return withNotice({ objects });
}

/**
 * "What links here" (the app's backlinks): the target must be visible to the person (404 like the
 * app) on a board this credential may use; sources on boards of workspaces closed to it are left out.
 */
export async function backlinksForApi(call: ApiCall, uri: unknown): Promise<{ notice: string; backlinks: Backlink[] }> {
  const origins = appOrigins(call.req);
  const ref = typeof uri === 'string' ? parseObjectUri(uri, origins) : null;
  const all = await backlinksOf({ userId: call.userId }, uri, origins);
  const targetBoard = ref?.type === 'board' || ref?.type === 'doc' ? ref.id : ref?.type === 'element' ? ref.boardId : null;
  if (targetBoard) {
    if (!(await readable(call, [targetBoard], false)).has(targetBoard)) throw notFound('Not found');
    call.audit.target = { type: ref?.type === 'doc' ? 'doc' : 'board', id: targetBoard };
  }
  const open = await readable(call, [...new Set(all.map((l) => l.board.id))], false);
  const backlinks = all.filter((l) => open.has(l.board.id));
  call.audit.metadata = { returned: backlinks.length, uri: ref ? formatObjectUri(ref) : null };
  return withNotice({ backlinks });
}

// The object registry (modules/objects): a linked tracker issue, `freero://issue/<linkId>`. Anyone
// who may see the board it is linked on may see it (with that access); its backlinks are the
// board items linked to it (modules/references, kind 'tracker'). Batched: one query for the
// links, one board check for all of them.
import { TRACKER_PROVIDERS, formatObjectUri, objectKey, type ObjectRef } from '@freero/shared';
import { registerObjectType, summarizeObjects, accessOf, type ObjectLookup, type ObjectTypeHandler } from '../objects/index';
import * as repo from './repo';

const issueObjects: ObjectTypeHandler = {
  type: 'issue',
  async lookup(actor, refs, opts) {
    const links = await repo.linksByIds(refs.map((r) => r.id));
    const boards = [...new Set(links.map((l) => l.boardId))].map((id): ObjectRef => ({ type: 'board', id }));
    const out = new Map<string, ObjectLookup>();
    if (opts.summaries) {
      const summaries = await summarizeObjects(actor, boards, opts.purpose);
      for (const l of links) {
        const b = summaries.get(formatObjectUri({ type: 'board', id: l.boardId }));
        if (!b) continue;
        out.set(objectKey({ type: 'issue', id: l.id }), {
          access: b.access,
          summary: {
            type: 'issue',
            title: l.externalKey,
            kind: l.provider,
            board: { id: l.boardId, title: b.title },
            text: `${TRACKER_PROVIDERS[l.provider]} issue linked to ${l.sources.length} item${l.sources.length === 1 ? '' : 's'}`,
            path: l.sources[0] ? `/board/${encodeURIComponent(l.boardId)}?item=${encodeURIComponent(l.sources[0])}` : `/board/${encodeURIComponent(l.boardId)}`,
            access: b.access,
          },
        });
      }
      return out;
    }
    const access = await accessOf(actor, boards, opts.purpose);
    for (const l of links) {
      const a = access.get(formatObjectUri({ type: 'board', id: l.boardId }));
      if (a) out.set(objectKey({ type: 'issue', id: l.id }), { access: a });
    }
    return out;
  },
};

export const registerIssueObjects = () => registerObjectType(issueObjects);

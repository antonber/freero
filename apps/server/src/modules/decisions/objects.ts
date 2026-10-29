// The object registry (modules/objects): a decision, `freero://decision/<id>` (web: /decision/<id>).
// Whoever may see its board may see it, with that access. Batched: one query for the decisions,
// one board check for all of them.
import { formatObjectUri, objectKey, type ObjectRef } from '@freero/shared';
import { accessOf, registerObjectType, summarizeObjects, type ObjectLookup, type ObjectTypeHandler } from '../objects/index';
import * as repo from './repo';

const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const decisionObjects: ObjectTypeHandler = {
  type: 'decision',
  async lookup(actor, refs, opts) {
    const rows = await repo.getMany(refs.map((r) => r.id));
    const boards = [...new Set(rows.map((d) => d.boardId))].map((id): ObjectRef => ({ type: 'board', id }));
    const out = new Map<string, ObjectLookup>();
    const boardKey = (id: string) => formatObjectUri({ type: 'board', id });
    if (opts.summaries) {
      const summaries = await summarizeObjects(actor, boards, opts.purpose);
      for (const d of rows) {
        const b = summaries.get(boardKey(d.boardId));
        if (!b) continue;
        out.set(objectKey({ type: 'decision', id: d.id }), {
          access: b.access,
          summary: {
            type: 'decision',
            title: d.title,
            kind: d.frameId ? 'frame' : 'board',
            board: { id: d.boardId, title: b.title },
            text: `Frozen ${day(d.createdAt)}${d.frameId ? ` · frame “${d.frameTitle || 'Untitled frame'}”` : ''}`,
            path: `/decision/${encodeURIComponent(d.id)}`,
            access: b.access,
          },
        });
      }
      return out;
    }
    const access = await accessOf(actor, boards, opts.purpose);
    for (const d of rows) {
      const a = access.get(boardKey(d.boardId));
      if (a) out.set(objectKey({ type: 'decision', id: d.id }), { access: a });
    }
    return out;
  },
};

export const registerDecisionObjects = () => registerObjectType(decisionObjects);

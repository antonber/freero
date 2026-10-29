// The object registry (modules/objects): a walkthrough, `freero://walkthrough/<id>` (web:
// /board/<boardId>?walkthrough=<id>). Whoever may see its board may see it, with that access.
// Batched: one query for the walkthroughs, one board check for all of them.
import { formatObjectUri, formatWalkthroughTime, objectKey, type ObjectRef } from '@freero/shared';
import { accessOf, registerObjectType, summarizeObjects, type ObjectLookup, type ObjectTypeHandler } from '../objects/index';
import { walkthroughsByIds } from './service';

const walkthroughObjects: ObjectTypeHandler = {
  type: 'walkthrough',
  async lookup(actor, refs, opts) {
    const rows = await walkthroughsByIds(refs.map((r) => r.id));
    const boards = [...new Set(rows.map((w) => w.boardId))].map((id): ObjectRef => ({ type: 'board', id }));
    const boardKey = (id: string) => formatObjectUri({ type: 'board', id });
    const out = new Map<string, ObjectLookup>();
    if (opts.summaries) {
      const summaries = await summarizeObjects(actor, boards, opts.purpose);
      for (const w of rows) {
        const b = summaries.get(boardKey(w.boardId));
        if (!b) continue;
        out.set(objectKey({ type: 'walkthrough', id: w.id }), {
          access: b.access,
          summary: {
            type: 'walkthrough',
            title: w.title,
            kind: w.media,
            board: { id: w.boardId, title: b.title },
            text: `Walkthrough · ${formatWalkthroughTime(w.durationMs)} · ${w.views} view${w.views === 1 ? '' : 's'}`,
            path: `/board/${encodeURIComponent(w.boardId)}?walkthrough=${encodeURIComponent(w.id)}`,
            access: b.access,
          },
        });
      }
      return out;
    }
    const access = await accessOf(actor, boards, opts.purpose);
    for (const w of rows) {
      const a = access.get(boardKey(w.boardId));
      if (a) out.set(objectKey({ type: 'walkthrough', id: w.id }), { access: a });
    }
    return out;
  },
};

export const registerWalkthroughObjects = () => registerObjectType(walkthroughObjects);

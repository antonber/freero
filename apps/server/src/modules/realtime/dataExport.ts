// Board content for data exports (modules/privacy): the shared doc as the board is right now
// (live, caught up with other instances), decoded to JSON per top-level collection, plus its Yjs
// state (lossless, importable), and the layers the exporting person may read: the `editors` layer
// (hidden frames' contents) for owners/editors, and their OWN private layer — never anyone else's.
// Also the comments a person wrote, with the thread and element they belong to.
import * as Y from 'yjs';
import { COMMENTS_COLLECTION } from './comments';
import { privateLayerOf } from './layers';
import { snapshotBoardDoc, snapshotBoardLayer } from './rooms';

export interface BoardContentExport {
  /** Yjs update of the whole shared doc (null: the board has no content). */
  state: Uint8Array | null;
  /** Every top-level collection as JSON (elements, settings, comments, tags, …). */
  json: Record<string, unknown>;
  layers: Array<{ name: 'editors' | 'private'; state: Uint8Array; json: Record<string, unknown> }>;
}

function decode(state: Uint8Array | null): Record<string, unknown> {
  if (!state) return {};
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    const out: Record<string, unknown> = {};
    for (const name of [...doc.share.keys()].sort()) out[name] = doc.getMap(name).toJSON();
    return out;
  } finally {
    doc.destroy();
  }
}

export async function exportBoardContent(boardId: string, opts: { editorsLayer: boolean; privateLayerOf: string | null }): Promise<BoardContentExport> {
  const state = await snapshotBoardDoc(boardId);
  const layers: BoardContentExport['layers'] = [];
  if (opts.editorsLayer) {
    const s = await snapshotBoardLayer(boardId, 'editors');
    if (s) layers.push({ name: 'editors', state: s, json: decode(s) });
  }
  if (opts.privateLayerOf) {
    const s = await snapshotBoardLayer(boardId, privateLayerOf(opts.privateLayerOf));
    if (s) layers.push({ name: 'private', state: s, json: decode(s) });
  }
  return { state, json: decode(state), layers };
}

export interface CommentThreadExport {
  threadId: string;
  /** What the thread is pinned to: an element (its type and text, when it has text) or a point. */
  pinnedTo: { elementId: string; type: string | null; text: string | null } | { x: number; y: number };
  resolved: boolean;
  startedByYou: boolean;
  /** Your messages in it (others' replies are their data, not yours). */
  messages: Array<{ id: string; text: string; createdAt: string; editedAt: string | null }>;
}

const plain = (html: unknown): string | null => {
  if (typeof html !== 'string' || !html.trim()) return null;
  const t = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return t.trim().slice(0, 2000) || null;
};

/**
 * The comments `userId` wrote on the board (live state), grouped by thread, deleted ones left out:
 * in the shared doc, the editors layer (threads on items in hidden frames, KAI-234) and their own
 * private layer. Their messages are theirs wherever they are; what a thread is pinned to is
 * described only from what they may see now (`seesHidden`: owner/editor reads hidden items).
 */
export async function commentsWrittenBy(boardId: string, userId: string, opts: { seesHidden: boolean } = { seesHidden: false }): Promise<CommentThreadExport[]> {
  const state = await snapshotBoardDoc(boardId);
  if (!state) return [];
  const docs: Array<{ doc: Y.Doc; readable: boolean }> = [];
  const load = (s: Uint8Array | null, readable: boolean) => {
    if (!s) return;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, s);
    docs.push({ doc, readable });
  };
  try {
    load(state, true);
    load(await snapshotBoardLayer(boardId, 'editors'), opts.seesHidden);
    load(await snapshotBoardLayer(boardId, privateLayerOf(userId)), true);
    // Records of one thread live in one doc: read them all as one collection.
    const comments = new Map<string, Record<string, unknown>>();
    const visible = new Map<string, Record<string, unknown>>();
    for (const { doc, readable } of docs) {
      for (const [k, v] of doc.getMap<Record<string, unknown>>(COMMENTS_COLLECTION).entries()) comments.set(k, v);
      if (readable) for (const [k, v] of doc.getMap<Record<string, unknown>>('elements').entries()) visible.set(k, v);
    }
    const elements = { get: (id: string) => visible.get(id) };
    const gone = new Set<string>();
    for (const [key, v] of comments.entries()) if (key.startsWith('x:') && v?.kind === 'deleted') gone.add(v.messageId ? `${v.threadId}:${v.messageId}` : String(v.threadId));
    const threads = new Map<string, CommentThreadExport>();
    for (const [key, v] of comments.entries()) {
      if (!key.startsWith('m:') || v?.kind !== 'message' || v.authorId !== userId) continue;
      const threadId = String(v.threadId);
      if (gone.has(threadId) || gone.has(`${threadId}:${v.id}`)) continue;
      let t = threads.get(threadId);
      if (!t) {
        const rec = comments.get(`t:${threadId}`);
        const status = comments.get(`s:${threadId}`);
        const elementId = typeof rec?.elementId === 'string' ? rec.elementId : null;
        const el = elementId ? elements.get(elementId) : undefined;
        t = {
          threadId,
          pinnedTo: elementId
            ? { elementId, type: typeof el?.type === 'string' ? el.type : null, text: plain(el?.text ?? el?.title) }
            : { x: Number(rec?.x ?? 0), y: Number(rec?.y ?? 0) },
          resolved: status?.resolved === true,
          startedByYou: rec?.createdBy === userId,
          messages: [],
        };
        threads.set(threadId, t);
      }
      t.messages.push({
        id: String(v.id),
        text: String(v.text),
        createdAt: new Date(Number(v.createdAt)).toISOString(),
        editedAt: typeof v.editedAt === 'number' ? new Date(v.editedAt).toISOString() : null,
      });
    }
    for (const t of threads.values()) t.messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return [...threads.values()];
  } finally {
    for (const { doc } of docs) doc.destroy();
  }
}

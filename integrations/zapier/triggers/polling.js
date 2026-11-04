// Polling triggers that anyone who can open a board may use (no webhook, no admin role): new items
// and new comments on one board, newest first, deduplicated by Zapier on their ids.
'use strict';

const { api, boardId } = require('../lib/freero');

const MAX_PAGES = 5;

/** Every item you can see on the board (up to MAX_PAGES pages of 1,000), newest first. */
async function itemsOf(z, bundle, id) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = { limit: 1000 };
    if (cursor) params.cursor = cursor;
    if (bundle.inputData.type) params.type = bundle.inputData.type;
    const r = await z.request({ url: api(bundle, `/boards/${encodeURIComponent(id)}/items`), params });
    out.push(...r.data.items);
    cursor = r.data.nextCursor;
    if (!cursor) break;
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

const boardField = { key: 'board', label: 'Board', required: true, dynamic: 'boards.id.title', helpText: 'Pick a board, or paste its link.' };

module.exports = {
  new_item: {
    key: 'new_item',
    noun: 'Item',
    display: { label: 'New Item', description: 'Triggers when a sticky note, card or other item is added to a board.' },
    operation: {
      inputFields: [
        boardField,
        { key: 'type', label: 'Only items of type', required: false, choices: { sticky: 'Sticky note', card: 'Card', text: 'Text', shape: 'Shape', frame: 'Frame', image: 'Image' } },
      ],
      perform: async (z, bundle) => {
        const id = boardId(bundle.inputData.board);
        return (await itemsOf(z, bundle, id)).slice(0, 100).map((it) => ({
          id: it.id,
          type: it.type,
          text: it.text || '',
          frame_id: it.frameId || '',
          created_at: new Date(it.createdAt).toISOString(),
          link: `${new URL(api(bundle, '/')).origin}/board/${encodeURIComponent(id)}?item=${encodeURIComponent(it.id)}`,
        }));
      },
      sample: { id: 's1', type: 'sticky', text: 'Ship the importer', frame_id: '', created_at: '2026-10-28T23:41:07.512Z', link: 'https://freero.app/board/b1?item=s1' },
    },
  },
  new_comment: {
    key: 'new_comment',
    noun: 'Comment',
    display: { label: 'New Comment', description: 'Triggers when someone comments on a board or replies in a thread.' },
    operation: {
      inputFields: [boardField],
      perform: async (z, bundle) => {
        const id = boardId(bundle.inputData.board);
        const r = await z.request({ url: api(bundle, `/boards/${encodeURIComponent(id)}/comments`) });
        return r.data.threads
          .flatMap((t) => t.messages.map((m) => ({ id: m.id, thread_id: t.id, item_id: t.itemId || '', author: m.author, text: m.text, at: new Date(m.at).toISOString(), at_ms: m.at })))
          .sort((a, b) => b.at_ms - a.at_ms)
          .slice(0, 100)
          .map(({ at_ms, ...rest }) => rest);
      },
      sample: { id: 'm1', thread_id: 't1', item_id: 's1', author: 'Maria', text: 'Can we ship this on Friday?', at: '2026-10-28T23:41:07.512Z' },
    },
  },
};

// Actions: add a sticky note, a card, a comment; create a board. Items are laid out on free space by
// Freero (never coordinates), optionally into a frame or a kanban column — the REST API's
// structure operation (docs/board-outline.md).
'use strict';

const { api, boardId } = require('../lib/freero');

const STICKY_COLORS = ['yellow', 'orange', 'coral', 'pink', 'violet', 'blue', 'cyan', 'green', 'lime', 'gray', 'white'];

const boardField = { key: 'board', label: 'Board', required: true, dynamic: 'boards.id.title', helpText: 'Pick a board, or paste its link.' };
const intoField = {
  key: 'into',
  label: 'Into frame or kanban',
  required: false,
  helpText: 'Optional: the id of a frame or kanban on the board (Copy link to item in Freero: the part after item=). Leave it empty for free space.',
};

/** Adds `items` to the board through the structure operation; answers the new items' ids and the board link. */
async function addItems(z, bundle, items, placement) {
  const id = boardId(bundle.inputData.board);
  const body = { structure: { kind: 'items', items } };
  if (placement) body.placement = placement;
  const r = await z.request({ url: api(bundle, `/boards/${encodeURIComponent(id)}/structure`), method: 'POST', body });
  const created = r.data.created || [];
  const origin = new URL(api(bundle, '/')).origin;
  return { id: created[0] || '', ids: created, board_id: id, link: `${origin}/board/${encodeURIComponent(id)}${created[0] ? `?item=${encodeURIComponent(created[0])}` : ''}` };
}

const itemSample = { id: 's1', ids: ['s1'], board_id: 'b1', link: 'https://freero.app/board/b1?item=s1' };

module.exports = {
  create_sticky: {
    key: 'create_sticky',
    noun: 'Sticky Note',
    display: { label: 'Add Sticky Note', description: 'Adds a sticky note to a board, on free space or into a frame.', important: true },
    operation: {
      inputFields: [boardField, { key: 'text', label: 'Text', required: true, type: 'text' }, { key: 'color', label: 'Color', required: false, choices: STICKY_COLORS, default: 'yellow' }, intoField],
      perform: (z, bundle) => {
        const sticky = { type: 'sticky', text: bundle.inputData.text };
        if (bundle.inputData.color) sticky.color = bundle.inputData.color;
        return addItems(z, bundle, [sticky], bundle.inputData.into ? { into: bundle.inputData.into } : null);
      },
      sample: itemSample,
    },
  },
  create_card: {
    key: 'create_card',
    noun: 'Card',
    display: { label: 'Add Card', description: 'Adds a task card to a board, or into a kanban column.', important: true },
    operation: {
      inputFields: [
        boardField,
        { key: 'title', label: 'Title', required: true },
        { key: 'description', label: 'Description', required: false, type: 'text' },
        { key: 'link', label: 'Link', required: false, helpText: 'An https address shown on the card.' },
        { key: 'due', label: 'Due date', required: false, type: 'datetime' },
        { ...intoField, label: 'Into kanban or frame' },
        { key: 'column', label: 'Kanban column', required: false, helpText: 'The column’s title, such as To do (with a kanban above).' },
      ],
      perform: (z, bundle) => {
        const d = bundle.inputData;
        const card = { type: 'card', text: d.title };
        if (d.description) card.description = d.description;
        if (d.link) card.link = d.link;
        if (d.due) card.dueDate = String(d.due).slice(0, 10);
        const placement = d.into ? { into: d.into, ...(d.column ? { column: d.column } : {}) } : null;
        return addItems(z, bundle, [card], placement);
      },
      sample: itemSample,
    },
  },
  add_comment: {
    key: 'add_comment',
    noun: 'Comment',
    display: { label: 'Add Comment', description: 'Comments on a board, or on one of its items.' },
    operation: {
      inputFields: [boardField, { key: 'text', label: 'Comment', required: true, type: 'text' }, { key: 'item', label: 'On item', required: false, helpText: 'Optional: the item’s id (Copy link to item: the part after item=).' }],
      perform: async (z, bundle) => {
        const id = boardId(bundle.inputData.board);
        const body = { text: bundle.inputData.text };
        if (bundle.inputData.item) body.itemId = bundle.inputData.item;
        const r = await z.request({ url: api(bundle, `/boards/${encodeURIComponent(id)}/comments`), method: 'POST', body });
        const t = r.data.thread;
        return { id: t.id, item_id: t.itemId || '', board_id: id, text: (t.messages[0] && t.messages[0].text) || '' };
      },
      sample: { id: 't1', item_id: '', board_id: 'b1', text: 'Looks good' },
    },
  },
  create_board: {
    key: 'create_board',
    noun: 'Board',
    display: { label: 'Create Board', description: 'Creates a board in one of your workspaces.' },
    operation: {
      inputFields: [
        { key: 'title', label: 'Title', required: true },
        { key: 'description', label: 'Description', required: false, type: 'text' },
        { key: 'workspace', label: 'Workspace', required: false, dynamic: 'workspaces.id.name', helpText: 'Your personal workspace if empty.' },
      ],
      perform: async (z, bundle) => {
        const body = { title: bundle.inputData.title };
        if (bundle.inputData.description) body.description = bundle.inputData.description;
        if (bundle.inputData.workspace) body.workspaceId = bundle.inputData.workspace;
        const r = await z.request({ url: api(bundle, '/boards'), method: 'POST', body });
        return r.data.board;
      },
      sample: { id: 'b1', title: 'Launch plan', description: '', url: 'https://freero.app/board/b1', role: 'owner', workspaceId: 'w1' },
    },
  },
};

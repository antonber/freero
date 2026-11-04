// "Board event" — instant (REST hook): the Zap adds a webhook to the team workspace for the chosen
// events (optionally one board), and removes it when the Zap is turned off. Each delivery is
// checked against the webhook's signing secret before the Zap runs. Needs an owner or admin of the
// workspace; only boards the whole team can open send events (docs/events.md).
'use strict';

const { api, boardId, flattenEvent, header, validSignature } = require('../lib/freero');

const EVENTS = {
  'item.created': 'An item was added',
  'item.updated': 'An item changed',
  'item.deleted': 'An item was deleted',
  'comment.created': 'Someone commented',
  'board.created': 'A board was created',
  'board.renamed': 'A board was renamed',
  'board.moved': 'A board was moved',
  'board.trashed': 'A board was trashed',
  'board.restored': 'A board was restored',
  'member.added': 'Someone was given access',
  'member.role_changed': 'Someone’s access changed',
  'member.removed': 'Someone’s access was removed',
};

const SAMPLE = {
  id: 'evt_1042',
  type: 'item.created',
  created_at: '2026-10-28T23:41:07.512Z',
  workspace_id: 'w1',
  board_id: 'b1',
  board_title: 'Team roadmap',
  board_url: 'https://freero.app/board/b1',
  actor_kind: 'user',
  actor_name: 'Maria',
  item_id: 's1',
  item_type: 'sticky',
  container_id: '',
  text: 'Ship the importer',
  thread_id: '',
  data: { item: { id: 's1', type: 'sticky', text: 'Ship the importer' } },
};

const subscribe = (z, bundle) => {
  const body = { url: bundle.targetUrl, events: [].concat(bundle.inputData.events || []), format: 'json', description: 'Zapier' };
  if (bundle.inputData.board) body.scope = String(bundle.inputData.board).includes('/') ? String(bundle.inputData.board) : `freero://board/${boardId(bundle.inputData.board)}`;
  return z
    .request({ url: api(bundle, `/workspaces/${encodeURIComponent(bundle.inputData.workspace)}/webhooks`), method: 'POST', body })
    .then((r) => ({ id: r.data.webhook.id, workspace: bundle.inputData.workspace, secret: r.data.secret }));
};

const unsubscribe = (z, bundle) => {
  const s = bundle.subscribeData || {};
  return z.request({ url: api(bundle, `/workspaces/${encodeURIComponent(s.workspace)}/webhooks/${encodeURIComponent(s.id)}`), method: 'DELETE' }).then((r) => r.data);
};

/** A delivery: only a correctly signed event of a chosen type runs the Zap (tests' pings and forgeries don't). */
const perform = (z, bundle) => {
  const raw = bundle.rawRequest || {};
  const body = typeof raw.content === 'string' ? raw.content : JSON.stringify(bundle.cleanedRequest || {});
  const secret = bundle.subscribeData && bundle.subscribeData.secret;
  if (!validSignature(secret, header(raw, 'freero-signature'), body)) {
    z.console.log('Freero: a delivery without a valid Freero-Signature was ignored');
    return [];
  }
  let e;
  try {
    e = JSON.parse(body);
  } catch (err) {
    return [];
  }
  const wanted = [].concat(bundle.inputData.events || []);
  if (!e || e.type === 'ping' || (wanted.length && !wanted.includes(e.type))) return [];
  return [flattenEvent(e)];
};

/** Samples for the Zap editor: what is on the chosen board now, shaped like item events. */
const performList = (z, bundle) => {
  if (!bundle.inputData.board) return [SAMPLE];
  const id = boardId(bundle.inputData.board);
  return Promise.all([z.request({ url: api(bundle, `/boards/${encodeURIComponent(id)}`) }), z.request({ url: api(bundle, `/boards/${encodeURIComponent(id)}/items`), params: { limit: 25 } })]).then(([b, items]) => {
    const board = b.data.board;
    const list = items.data.items
      .slice()
      .sort((x, y) => y.createdAt - x.createdAt)
      .map((it) =>
        flattenEvent({
          id: `sample_${it.id}`,
          type: 'item.created',
          createdAt: new Date(it.createdAt).toISOString(),
          workspaceId: board.workspaceId,
          board: { id: board.id, title: board.title, url: board.url },
          actor: { kind: 'user', id: it.createdBy || '', name: '' },
          data: { item: { id: it.id, type: it.type, text: it.text || '' } },
        }),
      );
    return list.length ? list : [SAMPLE];
  });
};

module.exports = {
  key: 'board_event',
  noun: 'Event',
  display: {
    label: 'Board Event',
    description: 'Triggers instantly when something happens on a board of a team workspace you administer: an item is added or changed, someone comments, a board is created.',
    important: true,
  },
  operation: {
    type: 'hook',
    inputFields: [
      { key: 'workspace', label: 'Team workspace', required: true, dynamic: 'admin_workspaces.id.name', helpText: 'A team workspace you own or administer. Its webhooks report only boards the whole team can open.' },
      { key: 'events', label: 'Events', required: true, list: true, choices: EVENTS, default: 'item.created' },
      { key: 'board', label: 'Only for board', required: false, dynamic: 'boards.id.title', helpText: 'Watch only this board (or paste a board link, or a frame’s copied link). Leave it empty for every board the team can open.' },
    ],
    performSubscribe: subscribe,
    performUnsubscribe: unsubscribe,
    perform,
    performList,
    sample: SAMPLE,
    outputFields: [
      { key: 'id', label: 'Event ID' },
      { key: 'type', label: 'Event type' },
      { key: 'board_title', label: 'Board title' },
      { key: 'board_url', label: 'Board link' },
      { key: 'actor_name', label: 'Who' },
      { key: 'text', label: 'Text' },
      { key: 'item_id', label: 'Item ID' },
    ],
  },
};

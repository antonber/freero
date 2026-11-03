// Kanbans through the MCP tools (step 2e: define_fields, configure_view, query_cards, add_cards with
// fields, update_items moving cards by value), driven by the official MCP client over real HTTP
// (in-memory Postgres). What matters is the board the people on it see afterwards: the server lays
// the kanban out by the board's own rule (@freero/shared planKanban) in the same change.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport, type CallToolResult } from '@modelcontextprotocol/client';
import { KANBAN_LAYOUT, kanbanColumnAt, kanbanLaneAt, kanbanLanesTop, type BoardElement, type CardElement, type KanbanElement } from '@freero/shared';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createPersonalToken } from '../apiauth/index';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { readBoardView } from '../realtime/index';
import mcpRoutes, { mountPath } from './routes';

let server: http.Server;
let url: URL;
let ownerId: string;
let client: Client;

beforeAll(async () => {
  const config = await openTestDb({ PUBLIC_URL: 'http://freero.test' });
  const app = createApp(config);
  app.use(mountPath, mcpRoutes({ config, onShutdown: () => undefined }));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
  ownerId = (await createUser({ name: 'Maria', email: 'maria@kanban.test.freero.app', password: 'password-123' })).id;
  const { secret } = await createPersonalToken(ownerId, 'password', { name: 'Claude', scopes: ['boards:read', 'boards:write'], expiresInDays: 1 });
  client = new Client({ name: 'freero-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${secret}` } } }));
});
afterAll(async () => {
  await client.close();
  await new Promise((r) => server.close(r));
  await closeTestDb();
});

const textOf = (r: unknown) => ((r as CallToolResult).content as Array<{ type: string; text?: string }>).map((c) => c.text ?? '').join('\n');
async function call(name: string, args: Record<string, unknown>) {
  const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
  expect(r.isError, `${name}: ${textOf(r)}`).toBeFalsy();
  return r.structuredContent as Record<string, unknown>;
}
const refused = async (name: string, args: Record<string, unknown>) => {
  const r = (await client.callTool({ name, arguments: args })) as CallToolResult;
  expect(r.isError, name).toBe(true);
  return textOf(r);
};
const elements = async (boardId: string) => new Map((await readBoardView(boardId, { userId: ownerId, role: 'owner' })).elements.map((e) => [e.el.id, e.el]));

/** A sprint kanban (To do / Doing / Done) with Team, Priority and Points, and its cards' ids. */
async function sprint(cards: string[]) {
  const boardId = (await createBoard(ownerId, 'Sprint', '')).id;
  const made = await call('add_cards', { boardId, title: 'Sprint', columns: [{ title: 'To do', cards: cards.map((title) => ({ title })) }, { title: 'Doing', cards: [] }, { title: 'Done', cards: [] }] });
  const kanbanId = made.kanbanId as string;
  const ids = (made.columns as Array<{ ids: string[] }>)[0].ids;
  await call('define_fields', {
    boardId,
    kanbanId,
    fields: [
      { name: 'Team', type: 'select', options: [{ label: 'Web' }, { label: 'API' }] },
      { name: 'Priority', type: 'select', options: [{ label: 'P0' }, { label: 'P1' }] },
      { name: 'Points', type: 'number' },
    ],
  });
  return { boardId, kanbanId, ids };
}

/** Where a card stands on its kanban: column title, row (option label), status. */
async function where(boardId: string, kanbanId: string, id: string) {
  const els = await elements(boardId);
  const k = els.get(kanbanId) as KanbanElement;
  const c = els.get(id) as CardElement;
  const team = (k.fields as Array<{ name: string; options?: Array<{ id: string; label: string }> }>).find((f) => f.name === 'Team')!;
  const lane = k.lanes?.length ? k.lanes[kanbanLaneAt(k, c.y + c.h / 2)].id : null;
  return {
    column: (k.columns[kanbanColumnAt(k, c.x + c.w / 2)].title as string).replace(/<[^>]+>/g, ''),
    row: lane === null ? null : (team.options?.find((o) => o.id === lane)?.label ?? lane),
    status: c.status,
    // Stacked inside its row's band, not left where a move put it.
    inRow: !k.lanes?.length || (c.y >= kanbanLanesTop(k) && c.y + c.h <= kanbanLanesTop(k) + k.lanes.reduce((s, l) => s + l.h, 0)),
  };
}

it('an agent adds a card with its fields into the Doing × Web cell of a kanban with swimlanes by Team: it lands in that cell, takes Doing’s status and keeps its values, in one change', async () => {
  const { boardId, kanbanId } = await sprint(['Write docs']);
  await call('configure_view', { boardId, kanbanId, subGroupBy: 'Team' });
  const added = await call('add_cards', { boardId, cards: [{ title: 'Ship the site', fields: { Team: 'Web', Priority: 'P1', Points: 3 } }], placement: { into: kanbanId, column: 'Doing' } });
  const id = (added.ids as string[])[0];
  expect(await where(boardId, kanbanId, id)).toEqual({ column: 'Doing', row: 'Web', status: 'doing', inRow: true });
  // Stacked at the top of its (empty) cell, as a drop there would stack it.
  const els = await elements(boardId);
  const k = els.get(kanbanId) as KanbanElement;
  const lane = k.lanes!.findIndex((l) => l.id === (els.get(id) as CardElement).values?.[(k.fields as Array<{ id: string; name: string }>).find((f) => f.name === 'Team')!.id]);
  const cellTop = kanbanLanesTop(k) + k.lanes!.slice(0, lane).reduce((s, l) => s + l.h, 0) + KANBAN_LAYOUT.laneHeadH + KANBAN_LAYOUT.pad;
  expect((els.get(id) as CardElement).y).toBeCloseTo(cellTop);
  const md = textOf(await client.callTool({ name: 'get_board_outline', arguments: { boardId } }));
  expect(md).toContain('rows: Team');
  expect(md).toMatch(/Ship the site[^\n]*Team: Web[^\n]*Priority: P1[^\n]*Points: 3/);
  // A field the kanban doesn't have is refused, and nothing is added.
  const before = (await elements(boardId)).size;
  expect(await refused('add_cards', { boardId, cards: [{ title: 'Nope', fields: { Severity: 'High' } }], placement: { into: kanbanId } })).toContain('no field “Severity”');
  expect((await elements(boardId)).size).toBe(before);
});

it('update_items setting a card’s Team moves it to that swimlane, and its Stage (the column field) to that column with the column’s status — laid out in the same change, no client needed', async () => {
  const { boardId, kanbanId, ids } = await sprint(['Fix login', 'Write docs']);
  await call('configure_view', { boardId, kanbanId, subGroupBy: 'Team' });
  const [card] = ids;
  await call('update_items', { boardId, items: [{ id: card, fields: { Team: 'Web' } }] });
  expect(await where(boardId, kanbanId, card)).toEqual({ column: 'To do', row: 'Web', status: 'todo', inRow: true });
  await call('update_items', { boardId, items: [{ id: card, fields: { Stage: 'Done' } }] });
  expect(await where(boardId, kanbanId, card)).toEqual({ column: 'Done', row: 'Web', status: 'done', inRow: true });
});

it('a saved filter set by configure_view folds the cards it leaves out away below the board and the outline marks them; query_cards reads the same cards by the same rules, sorted and in pages', async () => {
  const { boardId, kanbanId, ids } = await sprint(['A', 'B', 'C']);
  const [a, b, c] = ids;
  await call('update_items', {
    boardId,
    items: [
      { id: a, fields: { Priority: 'P0', Points: 2 } },
      { id: b, fields: { Priority: 'P1', Points: 5 } },
      { id: c, fields: { Priority: 'P0', Points: 8 } },
    ],
  });
  expect(await refused('configure_view', { boardId, kanbanId, filter: { rules: [{ field: 'Assignee', op: 'isMe' }] } })).toContain('isMe');
  await call('configure_view', { boardId, kanbanId, filter: { rules: [{ field: 'Priority', op: 'is', value: 'P0' }] }, sort: [{ field: 'Points', dir: 'desc' }] });

  const els = await elements(boardId);
  const k = els.get(kanbanId) as KanbanElement;
  const y = (id: string) => (els.get(id) as BoardElement).y;
  expect(y(b)).toBeGreaterThan(k.y + k.h);
  // The column shows the two P0 cards, highest Points first.
  expect(y(c)).toBeLessThan(y(a));
  expect(y(a)).toBeLessThan(k.y + k.h);
  const md = textOf(await client.callTool({ name: 'get_board_outline', arguments: { boardId } }));
  expect(md).toContain('filter: Priority is P0');
  expect(md).toContain('sort: Points (descending)');
  expect(md).toMatch(/\] card: B[^\n]*filtered/);

  const all = (await call('query_cards', { boardId, kanbanId, filter: { rules: [{ field: 'Points', op: 'gt', value: 3 }] }, sort: [{ field: 'Points', dir: 'asc' }], limit: 1 })).untrusted_board_content as {
    total: number;
    cards: Array<{ title: string; filtered?: boolean; fields: Record<string, unknown> }>;
    nextCursor: string | null;
  };
  expect(all.total).toBe(2);
  expect(all.cards).toEqual([expect.objectContaining({ title: 'B', filtered: true, fields: expect.objectContaining({ Priority: 'P1', Points: 5 }) })]);
  const next = (await call('query_cards', { boardId, kanbanId, filter: { rules: [{ field: 'Points', op: 'gt', value: 3 }] }, sort: [{ field: 'Points', dir: 'asc' }], cursor: all.nextCursor! })).untrusted_board_content as { cards: Array<{ title: string }> };
  expect(next.cards.map((r) => r.title)).toEqual(['C']);
  const shown = (await call('query_cards', { boardId, kanbanId, useView: true })).untrusted_board_content as { cards: Array<{ title: string }> };
  expect(shown.cards.map((r) => r.title)).toEqual(['C', 'A']);
});

it('an agent adds a table tab sorted by Points and filtered to P0: no card on the board moves, the outline lists the tabs, query_cards with that view reads its rows in its order, and the Board tab can’t be deleted', async () => {
  const { boardId, kanbanId, ids } = await sprint(['A', 'B', 'C']);
  const [a, b, c] = ids;
  await call('update_items', {
    boardId,
    items: [
      { id: a, fields: { Priority: 'P0', Points: 2 } },
      { id: b, fields: { Priority: 'P1', Points: 5 } },
      { id: c, fields: { Priority: 'P0', Points: 8 } },
    ],
  });
  const before = [...(await elements(boardId)).values()].filter((el) => el.type === 'card').map((el) => [el.id, el.x, el.y]);
  const out = (await call('configure_view', { boardId, kanbanId, addView: { name: 'Hot list' }, filter: { rules: [{ field: 'Priority', op: 'is', value: 'P0' }] }, sort: [{ field: 'Points', dir: 'desc' }], show: ['Points', 'Priority'] }))
    .untrusted_board_content as { views: Array<{ id: string; name: string; layout: string; active?: boolean; show?: string[] }> };
  const tab = out.views.find((v) => v.name === 'Hot list')!;
  expect(tab).toMatchObject({ layout: 'table', show: ['Points', 'Priority'] });
  expect(out.views.find((v) => v.active)?.layout).toBe('board');
  expect([...(await elements(boardId)).values()].filter((el) => el.type === 'card').map((el) => [el.id, el.x, el.y])).toEqual(before);

  await call('configure_view', { boardId, kanbanId, view: 'hot list', active: true });
  const md = textOf(await client.callTool({ name: 'get_board_outline', arguments: { boardId } }));
  expect(md).toContain('views: Board, Hot list* (table)');
  const rows = (await call('query_cards', { boardId, kanbanId, view: tab.id })).untrusted_board_content as { cards: Array<{ title: string }> };
  expect(rows.cards.map((r) => r.title)).toEqual(['C', 'A']);
  // What moves the real cards belongs to the Board tab.
  expect(await refused('configure_view', { boardId, kanbanId, view: 'Hot list', groupBy: 'Priority' })).toContain('Board tab');
  expect(await refused('configure_view', { boardId, kanbanId, view: 'Board', remove: true })).toContain('can’t be deleted');
  await call('configure_view', { boardId, kanbanId, view: 'Hot list', remove: true });
  expect(textOf(await client.callTool({ name: 'get_board_outline', arguments: { boardId } }))).not.toContain('Hot list');
});

it('an agent adds a calendar on a date field of the kanban and a timeline in swimlanes by Team: no card moves, the outline says what places their cards, query_cards with the calendar reads its cards in date order (undated last), and a field that isn’t a date is refused with the date fields named', async () => {
  const { boardId, kanbanId, ids } = await sprint(['A', 'B', 'C']);
  const [a, b, c] = ids;
  await call('define_fields', { boardId, kanbanId, fields: [{ name: 'Launch', type: 'date' }] });
  await call('update_items', {
    boardId,
    items: [
      { id: a, dueDate: '2026-11-20', fields: { Launch: '2026-12-09', Team: 'Web' } },
      { id: b, startDate: '2026-11-01', dueDate: '2026-11-03', fields: { Team: 'API' } },
      { id: c, fields: { Launch: '2026-12-01' } },
    ],
  });
  const before = [...(await elements(boardId)).values()].filter((el) => el.type === 'card').map((el) => [el.id, el.x, el.y]);
  const cal = (await call('configure_view', { boardId, kanbanId, addView: { name: 'Launches', layout: 'calendar' }, date: 'launch' })).untrusted_board_content as { views: Array<Record<string, unknown>> };
  expect(cal.views.find((v) => v.name === 'Launches')).toMatchObject({ layout: 'calendar', date: 'Launch' });
  const tl = (await call('configure_view', { boardId, kanbanId, addView: { name: 'Plan', layout: 'timeline' }, subGroupBy: 'Team', scale: 'day' })).untrusted_board_content as { views: Array<Record<string, unknown>> };
  expect(tl.views.find((v) => v.name === 'Plan')).toMatchObject({ layout: 'timeline', start: 'Start date', end: 'Due date', scale: 'day', subGroupBy: 'Team' });
  expect([...(await elements(boardId)).values()].filter((el) => el.type === 'card').map((el) => [el.id, el.x, el.y])).toEqual(before);

  const plan = (await call('query_cards', { boardId, kanbanId, view: 'Plan' })).untrusted_board_content as { cards: Array<{ title: string; fields: Record<string, unknown> }> };
  expect(plan.cards.map((r) => [r.title, r.fields['Start date'] ?? null])).toEqual([['B', '2026-11-01'], ['A', null], ['C', null]]);
  const md = textOf(await client.callTool({ name: 'get_board_outline', arguments: { boardId } }));
  expect(md).toContain('views: Board*, Launches (calendar by Launch), Plan (timeline from Start date to Due date in lanes by Team)');
  const rows = (await call('query_cards', { boardId, kanbanId, view: 'Launches' })).untrusted_board_content as { cards: Array<{ title: string }> };
  expect(rows.cards.map((r) => r.title)).toEqual(['C', 'A', 'B']);
  expect(await refused('configure_view', { boardId, kanbanId, view: 'Launches', date: 'Points' })).toContain('date fields: Due date, Start date, Launch');
  expect(await refused('configure_view', { boardId, kanbanId, view: 'Launches', scale: 'week' })).toContain('isn’t a setting of a calendar tab');
});

it('define_fields deleting the Doing column hands its cards to To do with To do’s status; the column field itself and the field the board is grouped by can’t be deleted', async () => {
  const { boardId, kanbanId, ids } = await sprint(['Fix login']);
  const [card] = ids;
  await call('update_items', { boardId, items: [{ id: card, fields: { Stage: 'Doing' } }] });
  await call('define_fields', { boardId, kanbanId, fields: [{ name: 'Stage', options: [{ label: 'Doing', delete: true }, { label: 'Review', status: 'doing' }] }] });
  const els = await elements(boardId);
  expect((els.get(kanbanId) as KanbanElement).columns.map((col) => (col.title as string).replace(/<[^>]+>/g, ''))).toEqual(['To do', 'Done', 'Review']);
  expect(await where(boardId, kanbanId, card)).toMatchObject({ column: 'To do', status: 'todo' });
  expect(await refused('define_fields', { boardId, kanbanId, fields: [{ name: 'Stage', delete: true }] })).toContain('column field');
  await call('configure_view', { boardId, kanbanId, groupBy: 'Priority' });
  expect(await refused('define_fields', { boardId, kanbanId, fields: [{ name: 'Priority', delete: true }] })).toContain('grouped by');
});

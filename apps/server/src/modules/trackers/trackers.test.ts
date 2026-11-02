// Tracker sync at the seams where it can go wrong: the merge rule, descriptions in each tracker's
// format, webhook signatures, GitHub's managed section, writing a tracker's change back onto board
// items, and rate limits. End to end against mock trackers: `npm run verify -- --only tracker`.
import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  baseOf,
  boardView,
  cardValue,
  collectionSchema,
  issueValuesFromBoard,
  kanbanColumnAt,
  kanbanLaneAt,
  mergeField,
  priorityFieldOf,
  pullableFields,
  type BoardElement,
  type CardElement,
  type ElementDraft,
  type IssueValues,
  type KanbanElement,
  type Tag,
  type TimelineElement,
  withKanbanLayout,
} from '@freero/shared';
import { planPull, sourceOf } from './board';
import type { HttpResponse } from './http';
import { importIntoKanban, kanbanOf, planKanbanImport } from './kanban';
import type { ProviderConnection, RemoteIssue } from './providers/types';
import { trackerRequest, TrackerError } from './http';
import { planRoadmapImport } from './roadmap';
import { adfToMarkdown, markdownToAdf, markdownToWiki, wikiToMarkdown } from './markup';
import { github, managedPart, withManagedPart } from './providers/github';
import { jira } from './providers/jira';
import { linear } from './providers/linear';

const card = (title: string): IssueValues => ({ title, description: '', status: 'todo', labels: ['ux'], dueDate: null });

it('a change on one side flows to the other; the same field changed differently on both keeps the tracker’s value; a cluster’s title never splits back into its notes', () => {
  const base = baseOf(card('Pay with one click'), card('Pay with one click'));
  const can = { push: true, pull: true };
  // Board renamed it, Jira moved it: both survive.
  const board = { ...card('One-click pay'), dueDate: '2026-12-01' };
  const tracker = { ...card('Pay with one click'), status: 'doing' as const };
  expect(mergeField('title', base, board, tracker, can)).toMatchObject({ decision: 'push', conflict: false });
  expect(mergeField('dueDate', base, board, tracker, can)).toMatchObject({ decision: 'push', conflict: false });
  expect(mergeField('status', base, board, tracker, can)).toMatchObject({ decision: 'pull', conflict: false });
  // Both renamed it differently in one window: Jira's title wins, flagged as a conflict.
  expect(mergeField('title', base, board, { ...tracker, title: 'Checkout in one click' }, can)).toMatchObject({ decision: 'pull', conflict: true });
  // Both made the same change: nothing to write, nothing to report.
  expect(mergeField('title', base, board, { ...tracker, title: 'One-click pay' }, can)).toMatchObject({ decision: 'settle', conflict: false });
  // A cluster's title is made from its notes: a rename in Jira is never written into a note.
  const cluster = pullableFields([{ type: 'sticky' }, { type: 'sticky' }]);
  expect(cluster.has('title')).toBe(false);
  expect(mergeField('title', base, card('Pay with one click'), { ...tracker, title: 'Renamed in Jira' }, { push: true, pull: cluster.has('title') }).decision).toBe('none');
});

it('labels a tracker reorders or re-cases are not mistaken for an edit', () => {
  const base = baseOf({ labels: ['ux', 'Checkout'] }, { labels: ['ux', 'Checkout'] });
  expect(mergeField('labels', base, { labels: ['ux', 'Checkout'] }, { labels: ['checkout', 'UX'] }, { push: true, pull: true }).decision).toBe('none');
});

it('board text with markup characters reaches Jira as text, links as links, and reads back the same (ADF and wiki markup)', () => {
  const md = 'Card form *resets* on error {code} | [x]\n\n- Coupon field hidden ([open](https://freero.example/board/b?item=n1))\n- Too many steps';
  const adf = markdownToAdf(md);
  const texts = JSON.stringify(adf);
  // No ADF node other than text / link marks came from the board's words.
  expect(texts).not.toContain('"strong"');
  expect(adf.content[1]).toMatchObject({ type: 'bulletList' });
  expect(adfToMarkdown(adf)).toBe(md);
  const wiki = markdownToWiki(md);
  expect(wiki).toContain('\\*resets\\*');
  expect(wiki).toContain('[open|https://freero.example/board/b?item=n1]');
  expect(wikiToMarkdown(wiki)).toBe(md);
});

it('a webhook signed with another secret or altered after signing is refused, and a replayed Linear delivery too', () => {
  const secret = 's3cret';
  const body = Buffer.from(JSON.stringify({ webhookEvent: 'jira:issue_updated', issue: { id: '10001', key: 'WEB-1' } }));
  const sig = (b: Buffer, s = secret) => createHmac('sha256', s).update(b).digest('hex');
  const now = Date.now();
  expect(jira.webhook({ headers: { 'x-hub-signature': `sha256=${sig(body)}` }, rawBody: body, secret, now })).toEqual({ issues: ['10001', 'WEB-1'] });
  expect(jira.webhook({ headers: { 'x-hub-signature': `sha256=${sig(body, 'other')}` }, rawBody: body, secret, now })).toBeNull();
  const altered = Buffer.from(body.toString().replace('WEB-1', 'WEB-2'));
  expect(jira.webhook({ headers: { 'x-hub-signature': `sha256=${sig(body)}` }, rawBody: altered, secret, now })).toBeNull();
  const gh = Buffer.from(JSON.stringify({ issue: { number: 4 }, repository: { full_name: 'acme/web' } }));
  expect(github.webhook({ headers: { 'x-hub-signature-256': `sha256=${sig(gh)}` }, rawBody: gh, secret, now })).toEqual({ issues: ['acme/web#4'] });
  expect(github.webhook({ headers: {}, rawBody: gh, secret, now })).toBeNull();
  const fresh = Buffer.from(JSON.stringify({ type: 'Issue', data: { id: 'u1', identifier: 'ENG-1' }, webhookTimestamp: now }));
  expect(linear.webhook({ headers: { 'linear-signature': sig(fresh) }, rawBody: fresh, secret, now })).toEqual({ issues: ['u1', 'ENG-1'] });
  expect(linear.webhook({ headers: { 'linear-signature': sig(fresh) }, rawBody: fresh, secret, now: now + 5 * 60_000 })).toBeNull();
});

it('what people write in a GitHub issue outside Freero’s section survives Freero’s writes', () => {
  const first = withManagedPart('', 'Flaky login test', 'On the Freero board: [open](https://f.example/board/b?item=g1)');
  const edited = `Seen on CI three times.\n\n${first}\n\nOwner: @someone`;
  const next = withManagedPart(edited, 'Flaky login test on Safari', managedPart(edited).links);
  expect(next.startsWith('Seen on CI three times.')).toBe(true);
  expect(next.endsWith('Owner: @someone')).toBe(true);
  expect(managedPart(next)).toEqual({ description: 'Flaky login test on Safari', links: 'On the Freero board: [open](https://f.example/board/b?item=g1)' });
});

it('a status from the tracker moves a kanban card into the column with that status; labels added or removed there change only those tags', () => {
  const el = (e: Partial<BoardElement> & Record<string, unknown>) => ({ rotation: 0, z: 1, createdBy: 'u', createdAt: 0, updatedAt: 0, ...e }) as BoardElement;
  const kanban = el({
    id: 'kb',
    type: 'kanban',
    x: 0,
    y: 0,
    w: 888,
    h: 600,
    colW: 280,
    title: '',
    columns: [
      { id: 'a', title: 'To do', status: 'todo', color: '#000' },
      { id: 'b', title: 'Doing', status: 'doing', color: '#000' },
      { id: 'c', title: 'Done', status: 'done', color: '#000' },
    ],
  }) as KanbanElement;
  const inDone = el({ id: 'other', type: 'card', x: 606, y: 106, w: 260, h: 120, frameId: 'kb', status: 'done' });
  const c = el({ id: 'card', type: 'card', x: 22, y: 106, w: 260, h: 120, frameId: 'kb', status: 'todo', tags: ['t1', 't2'] });
  const s = el({ id: 'note', type: 'sticky', x: 900, y: 0, w: 200, h: 200, tags: ['t2'] });
  const tags = new Map<string, Tag>([
    ['t1', { id: 't1', name: 'ux', color: '#000' }],
    ['t2', { id: 't2', name: 'mobile', color: '#000' }],
  ]);
  const view = { elements: [kanban, inDone, c, s].map((e) => ({ el: e, layer: 'shared' as const })), collection: (n: string) => (n === 'tags' ? tags : new Map()) as ReadonlyMap<string, unknown> };
  let n = 0;
  const plan = planPull(view, [c, s], { status: 'done', labels: ['mobile', 'payments'] }, { fields: new Set(['status', 'labels']), provider: jira, previousLabels: ['ux', 'mobile'], userIdOf: () => null, newId: () => `new${++n}` });
  const patch = new Map(plan.update.map((u) => [u.id, u.patch]));
  const moved = patch.get('card')!;
  expect(moved.status).toBe('done');
  // Below the card already in Done, in that column.
  expect(moved.x).toBe(12 + 2 * (280 + 12) + 10);
  expect(moved.y).toBe(106 + 120 + 10);
  // 'ux' removed in the tracker, 'payments' added (a new tag); 'mobile' kept everywhere.
  const created = Object.values(plan.tags);
  expect(created.map((t) => t.name)).toEqual(['payments']);
  expect(moved.tags).toEqual(['t2', created[0].id]);
  expect(patch.get('note')!.tags).toEqual(['t2', created[0].id]);
});

it('roadmap import: issues join the timeline lane already named after their epic (no second lane), a due date alone makes a one-day bar, and an issue without dates waits in a skipped Unscheduled frame', () => {
  const t = {
    id: 'tl', type: 'timeline', x: 0, y: 0, w: 168 + 56 * 14, h: 56 + 2 * 92, rotation: 0, z: 0, createdBy: 'u', createdAt: 0, updatedAt: 0,
    title: 'Q4', start: '2026-11-02', end: '2026-12-27', scale: 'week',
    lanes: [{ id: 'l-search', title: 'Search', color: '#000', rows: 2 }, { id: 'l-pay', title: '<p>Checkout</p>', color: '#000', rows: 2 }],
  } as unknown as TimelineElement;
  const bar = { id: 'b0', type: 'timelinebar', x: 168, y: 62, w: 70, h: 30, frameId: 'tl', start: '2026-11-02', end: '2026-11-06', title: 'kickoff', color: '#000' } as unknown as BoardElement;
  const view = { elements: [t, bar].map((el) => ({ el, layer: 'shared' as const })) };
  const issue = (id: string, values: Partial<IssueValues>, epic: string) => ({ id, key: id, url: '', values: { title: id, description: '', labels: [], ...values }, assigneeName: null, updatedAt: 0, groups: { epic } });
  const draft = (id: string) => ({ id, type: 'card', x: 0, y: 0, w: 300, h: 120 }) as unknown as ElementDraft;
  let n = 0;
  const plan = planRoadmapImport(
    view,
    t,
    [
      { id: 'c1', issue: issue('PAY-1', { startDate: '2026-11-09', dueDate: '2026-11-20' }, 'checkout'), draft: draft('c1') },
      { id: 'c2', issue: issue('PAY-2', { dueDate: '2026-11-25' }, 'Checkout'), draft: draft('c2') },
      { id: 'c3', issue: issue('PAY-3', {}, 'Checkout'), draft: draft('c3') },
    ],
    { groupBy: 'epic', today: 20_400, newId: () => `id${++n}`, frameIndex: 3 },
  );
  const made = new Map(plan.create.map((d) => [d.id, d as unknown as Record<string, unknown>]));
  expect(plan.update.find((u) => u.id === 'tl')?.patch.lanes).toBeUndefined();
  const laneTop = 56 + 12 + 2 * 40;
  for (const id of ['c1', 'c2']) {
    const c = made.get(id)!;
    expect(c.frameId).toBe('tl');
    expect(Number(c.y) + 15).toBeGreaterThan(laneTop);
  }
  expect(made.get('c1')!.x).toBe(168 + 7 * 14);
  expect(made.get('c2')).toMatchObject({ startDate: '2026-11-25', dueDate: '2026-11-25', w: 14 });
  const tray = made.get(made.get('c3')!.frameId as string)!;
  expect(tray).toMatchObject({ type: 'frame', skip: true, index: 3 });
  expect(plan.unscheduled).toBe(1);
});

// ---- kanban fields (step 2f) ----

const el = (e: Partial<BoardElement> & Record<string, unknown>) => ({ rotation: 0, z: 1, createdBy: 'u', createdAt: 0, updatedAt: 0, ...e }) as BoardElement;
const sprint = (columns: KanbanElement['columns'], extra: Partial<KanbanElement> = {}) =>
  el({ id: 'kb', type: 'kanban', x: 0, y: 0, w: 12 + columns.length * 292, h: 600, colW: 280, title: 'Sprint', columns, ...extra }) as KanbanElement;
/** A card standing in column `i` of `k`. */
const cardIn = (k: KanbanElement, i: number, id: string, extra: Record<string, unknown> = {}) =>
  el({ id, type: 'card', x: k.x + 22 + i * 292, y: 106, w: 260, h: 100, frameId: k.id, title: id, description: '', status: k.columns[i].status ?? null, ...extra }) as CardElement;
const viewOf = (...els: BoardElement[]) => ({ elements: els.map((e) => ({ el: e, layer: 'shared' as const })), collection: () => new Map() as ReadonlyMap<string, unknown> });

it('an issue moved to “In review” in the tracker lands in the board’s In review column, not the first column of its category', () => {
  const k = sprint([
    { id: 'todo', title: 'To do', status: 'todo', color: '#000' },
    { id: 'doing', title: 'Doing', status: 'doing', color: '#000' },
    { id: 'review', title: 'In  Review', status: 'doing', color: '#000' },
    { id: 'done', title: 'Done', status: 'done', color: '#000' },
  ]);
  const c = cardIn(k, 0, 'c1');
  const plan = planPull(viewOf(k, c), [c], { status: 'doing', statusName: 'In review' }, { fields: pullableFields([{ type: 'card', card: {} as never }]), provider: jira, previousLabels: [], userIdOf: () => null, newId: () => 'x' });
  const moved = { ...c, ...plan.update.find((u) => u.id === 'c1')!.patch } as CardElement;
  expect(k.columns[kanbanColumnAt(k, moved.x + moved.w / 2)].id).toBe('review');
  expect(moved.status).toBe('doing');
});

it('issues imported into a kanban land in the column named after their status (by category when none is, a column of its own when no column has the category), with a Priority field made once from the tracker’s levels', () => {
  const k = sprint([
    { id: 'todo', title: 'To do', status: 'todo', color: '#000' },
    { id: 'review', title: 'In review', status: null, color: '#000' },
    { id: 'done', title: 'Done', status: 'done', color: '#000' },
  ]);
  let n = 0;
  const ids = () => `n${++n}`;
  const levels = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
  const first = planKanbanImport(
    k,
    [
      { id: 'a', values: { status: 'doing', statusName: 'IN REVIEW', priority: 'High' } },
      { id: 'b', values: { status: 'todo', statusName: 'Selected for development', priority: null } },
      { id: 'c', values: { status: 'doing', statusName: 'In progress', priority: 'Highest' } },
    ],
    { newId: ids, priorities: levels },
  );
  const titles = first.kanban.columns.map((c) => c.title.replace(/<[^>]+>/g, ''));
  // No column has the "doing" category: In progress gets its own, before Done (where work flows).
  expect(titles).toEqual(['To do', 'In review', 'In progress', 'Done']);
  const progress = first.kanban.columns[2];
  expect(progress.status).toBe('doing');
  expect([first.columnOf.get('a'), first.columnOf.get('b'), first.columnOf.get('c')]).toEqual(['review', 'todo', progress.id]);
  const prio = priorityFieldOf(collectionSchema(first.kanban))!;
  expect(prio.options!.map((o) => o.label)).toEqual(levels);
  expect(first.values.get('a')).toEqual({ [prio.id]: prio.options![1].id });
  expect(first.values.has('b')).toBe(false);
  // The cards show it.
  expect(boardView(first.kanban).card!.show[0]).toBe(prio.id);
  // A second import uses the same field and columns: nothing new.
  const second = planKanbanImport(first.kanban, [{ id: 'd', values: { status: 'doing', statusName: 'in progress', priority: 'low' } }], { newId: ids, priorities: levels });
  expect(second.patch).toBeNull();
  expect(second.columnOf.get('d')).toBe(progress.id);
  expect(second.values.get('d')).toEqual({ [prio.id]: prio.options![3].id });
});

it('a card moved to the In review column and given another Priority goes to Jira as that status by name and that priority, not as the first “in progress” transition', async () => {
  const k = sprint(
    [
      { id: 'doing', title: 'Doing', status: 'doing', color: '#000' },
      { id: 'review', title: 'In review', status: 'doing', color: '#000' },
    ],
    {
      fields: [
        { id: 'stage', name: 'Stage', type: 'select' },
        { id: 'p', name: 'priority', type: 'select', options: [{ id: 'hi', label: 'High', color: '#000' }, { id: 'lo', label: 'Low', color: '#000' }] },
      ],
    },
  );
  const view = viewOf(k);
  const read = (c: CardElement) => issueValuesFromBoard([sourceOf(c, new Map(), () => null, (x) => kanbanOf(view, x))], { itemUrl: (id) => id });
  const before = read(cardIn(k, 0, 'c', { values: { p: 'lo' } }));
  const after = read(cardIn(k, 1, 'c', { values: { p: 'hi' } }));
  const tracker: IssueValues = { status: 'doing', statusName: 'In Progress', priority: 'Low' };
  const base = baseOf(before, tracker);
  const can = { push: true, pull: true };
  expect((['status', 'statusName', 'priority'] as const).map((f) => mergeField(f, base, after, tracker, can).decision)).toEqual(['none', 'push', 'push']);

  // What Jira is asked for (a stand-in connection: no tracker is called).
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const reply = (json: unknown, status = 200): HttpResponse => ({ status, headers: {}, json, text: '' });
  const conn = {
    deployment: 'cloud',
    settings: {},
    site: 'https://acme.example',
    async call(req: { method: string; path: string; body?: unknown }) {
      calls.push(req);
      if (req.path.endsWith('/transitions') && req.method === 'GET')
        return reply({
          transitions: [
            { id: '21', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
            { id: '31', to: { name: 'In Review', statusCategory: { key: 'indeterminate' } } },
          ],
        });
      return reply({}, 204);
    },
  } as unknown as ProviderConnection;
  const issue = { id: '100', key: 'WEB-1', url: '', values: { title: 'x', description: '', labels: [], ...tracker }, assigneeName: null, updatedAt: 0 } as RemoteIssue;
  await jira.updateIssue(conn, issue, { statusName: after.statusName, priority: after.priority });
  expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ fields: { priority: { name: 'High' } } });
  expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/transitions'))?.body).toEqual({ transition: { id: '31' } });
});

it('a priority level the kanban’s Priority field lacks, pulled from the tracker, is added to the field and set on the card', () => {
  const k = sprint([{ id: 'todo', title: 'To do', status: 'todo', color: '#000' }], {
    fields: [
      { id: 'stage', name: 'Stage', type: 'select' },
      { id: 'p', name: 'Priority', type: 'select', options: [{ id: 'hi', label: 'High', color: '#000' }] },
    ],
  });
  const c = cardIn(k, 0, 'c', { values: { p: 'hi' } });
  const plan = planPull(viewOf(k, c), [c], { priority: 'Blocker' }, { fields: new Set(['priority']), provider: jira, previousLabels: [], userIdOf: () => null, newId: () => 'blk' });
  const patched = new Map(plan.update.map((u) => [u.id, u.patch]));
  const k2 = { ...k, ...patched.get('kb') } as KanbanElement;
  const c2 = { ...c, ...patched.get('c') } as CardElement;
  const field = priorityFieldOf(collectionSchema(k2))!;
  expect(field.options!.map((o) => o.label)).toEqual(['High', 'Blocker']);
  expect(cardValue(k2, c2, field)).toBe('blk');
});

it('on a kanban with swimlanes by Priority, a priority pulled from the tracker moves the card into that row, stacked there in the same change', () => {
  const fields = [
    { id: 'stage', name: 'Stage', type: 'select' as const },
    { id: 'p', name: 'Priority', type: 'select' as const, options: [{ id: 'hi', label: 'High', color: '#000' }, { id: 'lo', label: 'Low', color: '#000' }] },
  ];
  const k0 = sprint([{ id: 'todo', title: 'To do', status: 'todo', color: '#000' }], { fields, views: [{ id: 'board', name: 'Board', layout: 'board', groupBy: 'stage', subGroupBy: 'p' }] as never });
  const a = cardIn(k0, 0, 'a', { values: { p: 'hi' } });
  const b = cardIn(k0, 0, 'b', { values: { p: 'lo' } });
  // The board as a client laid it out: rows No Priority / High / Low.
  const laid = withKanbanLayout([k0, a, b], { update: [{ id: 'kb', patch: {} }] }).update;
  const at = (el: BoardElement) => ({ ...el, ...laid.find((u) => u.id === el.id)?.patch }) as BoardElement;
  const [k, ca, cb] = [at(k0) as KanbanElement, at(a) as CardElement, at(b) as CardElement];
  const rowOf = (kk: KanbanElement, c: BoardElement) => kk.lanes![kanbanLaneAt(kk, c.y + c.h / 2)].id;
  expect([rowOf(k, ca), rowOf(k, cb)]).toEqual(['hi', 'lo']);

  const plan = planPull(viewOf(k, ca, cb), [ca], { priority: 'Low' }, { fields: new Set(['priority']), provider: jira, previousLabels: [], userIdOf: () => null, newId: () => 'x' });
  const patched = new Map(plan.update.map((u) => [u.id, u.patch]));
  const k2 = { ...k, ...patched.get('kb') } as KanbanElement;
  const a2 = { ...ca, ...patched.get('a') } as CardElement;
  const b2 = { ...cb, ...patched.get('b') } as CardElement;
  expect(rowOf(k2, a2)).toBe('lo');
  // Below the card already in the Low row, not on top of it.
  expect(a2.y).toBeGreaterThanOrEqual(b2.y + b2.h);
});

it('issues imported into a kanban with a new status column opening before Done leave the cards already in Done there, still done', () => {
  const k = sprint([
    { id: 'todo', title: 'To do', status: 'todo', color: '#000' },
    { id: 'done', title: 'Done', status: 'done', color: '#000' },
  ]);
  const finished = cardIn(k, 1, 'finished');
  const plan = planKanbanImport(k, [{ id: 'new', values: { status: 'doing', statusName: 'In progress' } }], { newId: () => 'prog', priorities: null });
  expect(plan.kanban.columns.map((c) => c.id)).toEqual(['todo', 'prog', 'done']);
  const draft = { ...cardIn(plan.kanban, 1, 'new'), y: 400 } as unknown as ElementDraft;
  const change = importIntoKanban([k, finished], k, plan, { create: [draft], update: [] });
  const patched = new Map(change.update.map((u) => [u.id, u.patch]));
  const k2 = { ...k, ...patched.get('kb') } as KanbanElement;
  const f2 = { ...finished, ...patched.get('finished') } as CardElement;
  expect(k2.columns[kanbanColumnAt(k2, f2.x + f2.w / 2)].id).toBe('done');
  expect(f2.status).toBe('done');
  const n2 = change.create[0] as unknown as CardElement;
  expect(k2.columns[kanbanColumnAt(k2, n2.x + n2.w / 2)].id).toBe('prog');
});

let server: http.Server;
let port = 0;
const answers: Array<{ status: number; headers?: Record<string, string> }> = [];
beforeAll(async () => {
  server = http.createServer((_req, res) => {
    const a = answers.shift() ?? { status: 200 };
    res.writeHead(a.status, { 'content-type': 'application/json', ...a.headers });
    res.end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

it('a tracker that answers 429 is asked again after the wait it named; a longer wait is handed back instead of blocking', async () => {
  const waits: number[] = [];
  const sleep = async (ms: number) => void waits.push(ms);
  answers.push({ status: 429, headers: { 'retry-after': '2' } }, { status: 503 }, { status: 200 });
  const res = await trackerRequest({ method: 'GET', url: `http://127.0.0.1:${port}/x` }, { allowPrivate: true }, { sleep });
  expect(res.status).toBe(200);
  expect(waits[0]).toBe(2000);
  answers.push({ status: 429, headers: { 'retry-after': '120' } });
  const err = await trackerRequest({ method: 'GET', url: `http://127.0.0.1:${port}/x` }, { allowPrivate: true }, { sleep }).catch((e) => e);
  expect(err).toBeInstanceOf(TrackerError);
  expect(err).toMatchObject({ kind: 'rate', retryAfterMs: 120_000 });
  // An admin-typed private address is never called unless the operator allows private trackers.
  await expect(trackerRequest({ method: 'GET', url: `https://127.0.0.1:${port}/x` }, { allowPrivate: false })).rejects.toMatchObject({ kind: 'refused' });
  await expect(trackerRequest({ method: 'GET', url: `http://jira.example.com/x` }, { allowPrivate: false })).rejects.toMatchObject({ kind: 'invalid' });
});

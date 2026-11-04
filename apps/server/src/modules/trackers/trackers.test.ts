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
  customField,
  sprintFieldOf,
  type FieldMapEntry,
  type TrackerSprint,
  issueValuesFromBoard,
  kanbanColumnAt,
  kanbanLaneAt,
  mergeField,
  priorityFieldOf,
  pullableFields,
  syncedBase,
  trackerAgreed,
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
import { adfToMarkdown, asanaHtmlToMarkdown, htmlToMarkdown, markdownToAdf, markdownToAsanaHtml, markdownToHtml, markdownToWiki, wikiToMarkdown } from './markup';
import { asana } from './providers/asana';
import { azure } from './providers/azure';
import { clickup } from './providers/clickup';

import { github, managedPart, withManagedPart } from './providers/github';
import { jira } from './providers/jira';
import { linear } from './providers/linear';
import { monday } from './providers/monday';

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

it('a date changed on the board while a sync was pulling the title from Jira is still sent by the next sync, not taken as agreed', () => {
  const can = { push: true, pull: true };
  // The sync read the board, pulled Jira's new title; meanwhile someone dragged the bar to new dates.
  const read = { ...card('Checkout'), dueDate: '2026-11-10' };
  const tracker = { ...card('Checkout v2'), dueDate: '2026-11-10' };
  const afterWrite = { ...card('Checkout v2'), dueDate: '2026-11-30' };
  const base = syncedBase(read, afterWrite, ['title'], tracker);
  expect(mergeField('dueDate', base, afterWrite, tracker, can)).toMatchObject({ decision: 'push' });
  expect(mergeField('title', base, afterWrite, tracker, can).decision).toBe('none');
});

it('a status changed in the tracker while a sync was writing the board’s new title is pulled by the next sync, not taken as agreed', () => {
  const can = { push: true, pull: true };
  // The sync merged (todo), pushed the title; someone moved the issue before it read it back.
  const board = card('One-click pay');
  const merged = card('Pay with one click');
  const readBack = { ...card('One-click pay'), status: 'done' as const };
  const base = syncedBase(board, board, [], trackerAgreed(merged, readBack, ['title']));
  expect(mergeField('status', base, board, readBack, can)).toMatchObject({ decision: 'pull' });
  expect(mergeField('title', base, board, readBack, can).decision).toBe('none');
});

it('labels a tracker reorders or re-cases are not mistaken for an edit', () => {
  const base = baseOf({ labels: ['ux', 'Checkout'] }, { labels: ['ux', 'Checkout'] });
  expect(mergeField('labels', base, { labels: ['ux', 'Checkout'] }, { labels: ['checkout', 'UX'] }, { push: true, pull: true }).decision).toBe('none');
});

it('board text with markup characters reaches Jira, Azure DevOps and Asana as text, links as links, and reads back the same (ADF, wiki markup, HTML, Asana rich text)', () => {
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
  // Azure DevOps: HTML from the template only — a note saying <img onerror=…> stays words.
  const risky = `${md}\n\n<img src=x onerror=alert(1)> & [x](javascript:alert(1))`;
  const html = markdownToHtml(risky);
  expect(html).not.toMatch(/<img|href="javascript/i);
  expect(htmlToMarkdown(html)).toBe(risky);
  // Asana: its rich text (a <body>, newlines, no <p>), from the same escaped template.
  const notes = markdownToAsanaHtml(risky);
  expect(notes.startsWith('<body>') && notes.endsWith('</body>')).toBe(true);
  expect(notes).not.toMatch(/<img|<p>|<br|href="javascript/i);
  expect(asanaHtmlToMarkdown(notes)).toBe(risky);
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
  // Azure DevOps service hooks can't sign: the secret is their basic auth password.
  const hook = Buffer.from(JSON.stringify({ eventType: 'workitem.updated', resource: { id: 9001, workItemId: 42 } }));
  const basic = (pw: string) => `Basic ${Buffer.from(`freero:${pw}`).toString('base64')}`;
  expect(azure.webhook({ headers: { authorization: basic(secret) }, rawBody: hook, secret, now })).toEqual({ issues: ['42'] });
  expect(azure.webhook({ headers: { authorization: basic('guess') }, rawBody: hook, secret, now })).toBeNull();
  expect(azure.webhook({ headers: {}, rawBody: hook, secret, now })).toBeNull();
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

// ---- sprints (#119), the field map (#43), Azure DevOps (#6) ----

const TEAM: FieldMapEntry = { tracker: 'customfield_10050', trackerName: 'Team', board: 'Team', type: 'select' };
const teamField = (name: string) => ({ id: 'tf', name, type: 'select' as const, options: [{ id: 'web', label: 'Web', color: '#000' }, { id: 'mob', label: 'Mobile', color: '#000' }] });
const readCard = (k: KanbanElement, c: CardElement, map: FieldMapEntry[]) => issueValuesFromBoard([sourceOf(c, new Map(), () => null, (x) => kanbanOf(viewOf(k), x), map)], { itemUrl: (id) => id });

it('renaming the kanban field a field map names neither clears the tracker’s value nor loses its change: once the map names it again, the change made meanwhile reaches the card', () => {
  const can = { push: true, pull: true };
  const f = customField(TEAM.tracker);
  const k = sprint([{ id: 'todo', title: 'To do', status: 'todo', color: '#000' }], { fields: [{ id: 'stage', name: 'Stage', type: 'select' }, teamField('Team')] });
  const c = cardIn(k, 0, 'c', { values: { tf: 'web' } });
  const tracker = (team: string): IssueValues => ({ custom: { [TEAM.tracker]: team } });
  const base = baseOf(readCard(k, c, [TEAM]), tracker('Web'));

  // Someone renames the kanban's Team field to Squad; meanwhile Jira moves the issue to Mobile.
  const renamed = { ...k, fields: [{ id: 'stage', name: 'Stage', type: 'select' }, teamField('Squad')] } as KanbanElement;
  const read = readCard(renamed, c, [TEAM]);
  expect(mergeField(f, base, read, tracker('Mobile'), can).decision).not.toBe('push');
  const plan = planPull(viewOf(renamed, c), [c], { custom: { [TEAM.tracker]: 'Mobile' } }, { fields: pullableFields([{ type: 'card', card: {} as never }], [TEAM]), provider: jira, previousLabels: [], userIdOf: () => null, newId: () => 'x', map: [TEAM] });
  expect(plan.update.find((u) => u.id === 'c')?.patch.values).toBeUndefined();
  const next = syncedBase(read, read, [f], tracker('Mobile'), base);

  // The admin points the map at Squad: the card gets Mobile, its Web is not sent back.
  const squad = { ...TEAM, board: 'Squad' };
  const again = readCard(renamed, c, [squad]);
  expect(mergeField(f, next, again, tracker('Mobile'), can).decision).toBe('pull');
  const pulled = planPull(viewOf(renamed, c), [c], { custom: { [TEAM.tracker]: 'Mobile' } }, { fields: pullableFields([{ type: 'card', card: {} as never }], [squad]), provider: jira, previousLabels: [], userIdOf: () => null, newId: () => 'x', map: [squad] });
  expect(pulled.update.find((u) => u.id === 'c')?.patch.values).toEqual({ tf: 'mob' });
});

const SPRINTS: TrackerSprint[] = [
  { id: '1', name: 'WEB Sprint 1', state: 'closed' },
  { id: '2', name: 'WEB Sprint 2', state: 'active' },
  { id: '3', name: 'WEB Sprint 3', state: 'future' },
];

it('a sprint moved in the tracker moves the card’s Sprint value, adding the sprint the field lacks, and a sprint closed there becomes read-only on the kanban', () => {
  const sprintDef = { id: 'sp', name: 'Sprint', type: 'select' as const, options: [{ id: 's1', label: 'WEB Sprint 1', color: '#000' }, { id: 's2', label: 'WEB Sprint 2', color: '#000' }] };
  const k = sprint([{ id: 'todo', title: 'To do', status: 'todo', color: '#000' }], { fields: [{ id: 'stage', name: 'Stage', type: 'select' }, sprintDef] });
  const c = cardIn(k, 0, 'c', { values: { sp: 's2' } });
  const base = baseOf(readCard(k, c, []), { sprint: 'WEB Sprint 2' });
  expect(mergeField('sprint', base, readCard(k, c, []), { sprint: 'WEB Sprint 3' }, { push: true, pull: true }).decision).toBe('pull');
  const plan = planPull(viewOf(k, c), [c], { sprint: 'WEB Sprint 3' }, { fields: new Set(['sprint']), provider: jira, previousLabels: [], userIdOf: () => null, newId: () => 's3', sprints: SPRINTS });
  const patched = new Map(plan.update.map((u) => [u.id, u.patch]));
  const k2 = { ...k, ...patched.get('kb') } as KanbanElement;
  const field = sprintFieldOf(collectionSchema(k2))!;
  expect(field.options!.map((o) => [o.label, !!o.readOnly])).toEqual([
    ['WEB Sprint 1', true],
    ['WEB Sprint 2', false],
    ['WEB Sprint 3', false],
  ]);
  expect(cardValue(k2, { ...c, ...patched.get('c') } as CardElement, field)).toBe('s3');
});

it('issues imported by sprint give the kanban one Sprint field with the project’s open sprints, a closed sprint an issue still holds kept but read-only', () => {
  const k = sprint([{ id: 'todo', title: 'To do', status: 'todo', color: '#000' }]);
  let n = 0;
  const plan = planKanbanImport(k, [{ id: 'a', values: { status: 'todo', sprint: 'WEB Sprint 2' } }, { id: 'b', values: { status: 'todo', sprint: 'WEB Sprint 1' } }], {
    newId: () => `n${++n}`,
    priorities: null,
    sprints: SPRINTS,
    sprintFieldName: 'Sprint',
  });
  const field = sprintFieldOf(collectionSchema(plan.kanban))!;
  expect(field.options!.map((o) => [o.label, !!o.readOnly])).toEqual([
    ['WEB Sprint 2', false],
    ['WEB Sprint 3', false],
    ['WEB Sprint 1', true],
  ]);
  expect(plan.values.get('a')).toEqual({ [field.id]: field.options![0].id });
  expect(plan.values.get('b')).toEqual({ [field.id]: field.options![2].id });
  expect(boardView(plan.kanban).card!.show).toContain(field.id);
  // A second import adds no second field.
  const again = planKanbanImport(plan.kanban, [{ id: 'c', values: { status: 'todo', sprint: 'WEB Sprint 3' } }], { newId: () => `m${++n}`, priorities: null, sprints: SPRINTS, sprintFieldName: 'Sprint' });
  expect(collectionSchema(again.kanban).filter((f) => f.name === 'Sprint')).toHaveLength(1);
});

it('a Jira issue’s sprint is the open one it is in, not a closed sprint it passed through (current sites and older Data Center strings)', async () => {
  const reply = (fields: Record<string, unknown>) => ({ status: 200, headers: {}, text: '', json: { id: '1', key: 'WEB-1', fields: { summary: 'x', project: { key: 'WEB' }, ...fields } } });
  const conn = (deployment: string, fields: Record<string, unknown>) =>
    ({ deployment, site: 'https://acme.example', settings: { sprintField: 'customfield_10020' }, call: async () => reply(fields) }) as unknown as ProviderConnection;
  const cloudIssue = await jira.getIssue(conn('cloud', { customfield_10020: [{ id: 1, name: 'WEB Sprint 1', state: 'closed' }, { id: 2, name: 'WEB Sprint 2', state: 'active' }] }), '1');
  expect(cloudIssue?.values.sprint).toBe('WEB Sprint 2');
  const dc = await jira.getIssue(
    conn('datacenter', { customfield_10020: ['com.atlassian.greenhopper.service.sprint.Sprint@1a[id=1,rapidViewId=1,state=CLOSED,name=Old,startDate=x]', 'com.atlassian.greenhopper.service.sprint.Sprint@2b[id=4,rapidViewId=1,state=FUTURE,name=Next up,startDate=<null>]'] }),
    '1',
  );
  expect(dc?.values.sprint).toBe('Next up');
});

it('a write to an Azure DevOps work item names the revision Freero read, and one refused because someone changed the item since is a conflict to merge again, not a failure', async () => {
  const sent: Array<{ method: string; path: string; body?: unknown; headers?: Record<string, string> }> = [];
  const conn = {
    id: 'az',
    deployment: 'cloud',
    site: 'https://dev.azure.com/acme',
    apiBase: 'https://dev.azure.com/acme',
    settings: {},
    async call(req: { method: string; path: string; body?: unknown; headers?: Record<string, string> }) {
      sent.push(req);
      if (req.method === 'PATCH') return { status: 412, headers: {}, text: '', json: { message: 'TF26071: This work item has been changed by someone else since you opened it.' } };
      return { status: 200, headers: {}, text: '', json: { id: 7, rev: 5, fields: { 'System.WorkItemType': 'Task', 'System.TeamProject': 'Fabrikam' } } };
    },
  } as unknown as ProviderConnection;
  const issue = { id: '7', key: '#7', url: '', project: 'Fabrikam', version: '3', values: { title: 'Old', description: '', labels: [] }, assigneeName: null, updatedAt: 0 } as RemoteIssue;
  const err = await azure.updateIssue(conn, issue, { title: 'New' }).catch((e) => e);
  expect(err).toBeInstanceOf(TrackerError);
  expect(err.kind).toBe('conflict');
  const patch = sent.find((r) => r.method === 'PATCH')!;
  expect(patch.headers?.['content-type']).toBe('application/json-patch+json');
  // The revision the sync READ (3), not the one fetched just before writing (5).
  expect(patch.body).toEqual([
    { op: 'test', path: '/rev', value: 3 },
    { op: 'add', path: '/fields/System.Title', value: 'New' },
  ]);
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

// ---- Asana (#120) and monday.com (#121) ----

type Sent = { method: string; path: string; body?: unknown; headers?: Record<string, string> };
const SITES = { asana: ['https://app.asana.com', 'https://app.asana.com/api/1.0'], monday: ['https://monday.com', 'https://api.monday.com'], clickup: ['https://app.clickup.com', 'https://api.clickup.com/api/v2'] } as const;
const fakeConn = (provider: keyof typeof SITES, answer: (r: Sent) => { status?: number; json: unknown }, settings: Record<string, unknown> = {}) => {
  const sent: Sent[] = [];
  const conn = {
    id: provider,
    provider,
    deployment: null,
    site: SITES[provider][0],
    apiBase: SITES[provider][1],
    settings,
    async call(req: Sent) {
      sent.push(req);
      const a = answer(req);
      return { status: a.status ?? 200, headers: {}, text: JSON.stringify(a.json), json: a.json };
    },
  } as unknown as ProviderConnection;
  return { conn, sent };
};

it('an Asana handshake is answered only while Freero is registering that webhook and only once, and a delivery not signed with the secret it issued is refused', () => {
  const now = Date.now();
  const empty = Buffer.alloc(0);
  const handshake = { 'x-hook-secret': 'b7e4c1d0a9f8e7d6' };
  // Registering: the secret goes back in the answer and is kept.
  expect(asana.webhook({ headers: handshake, rawBody: empty, secret: 's', now, hook: { pending: true, secret: null } })).toEqual({
    issues: [],
    handshake: { headers: { 'X-Hook-Secret': 'b7e4c1d0a9f8e7d6' }, keep: 'b7e4c1d0a9f8e7d6' },
  });
  // Not registering, or a secret already kept: a stranger can't swap it for their own.
  expect(asana.webhook({ headers: handshake, rawBody: empty, secret: 's', now, hook: { pending: false, secret: null } })).toBeNull();
  expect(asana.webhook({ headers: handshake, rawBody: empty, secret: 's', now, hook: { pending: true, secret: 'b7e4c1d0a9f8e7d6' } })).toBeNull();
  const body = Buffer.from(JSON.stringify({ events: [{ action: 'changed', resource: { gid: '1201', resource_type: 'task' } }, { action: 'added', resource: { gid: '77', resource_type: 'story' }, parent: { gid: '1202', resource_type: 'task' } }] }));
  const sig = (s: string, b = body) => createHmac('sha256', s).update(b).digest('hex');
  const hook = { pending: false, secret: 'issued-by-asana' };
  expect(asana.webhook({ headers: { 'x-hook-signature': sig('issued-by-asana') }, rawBody: body, secret: 's', now, hook })).toEqual({ issues: ['1201', '1202'] });
  // Signed with the connection's own secret (not the one Asana issued), altered, or unsigned: refused.
  expect(asana.webhook({ headers: { 'x-hook-signature': sig('s') }, rawBody: body, secret: 's', now, hook })).toBeNull();
  expect(asana.webhook({ headers: { 'x-hook-signature': sig('issued-by-asana') }, rawBody: Buffer.from(body.toString().replace('1201', '1299')), secret: 's', now, hook })).toBeNull();
  expect(asana.webhook({ headers: {}, rawBody: body, secret: 's', now, hook })).toBeNull();
  // monday.com: its challenge is echoed only while Freero registers the webhook.
  const challenge = Buffer.from(JSON.stringify({ challenge: 'c-123' }));
  expect(monday.webhook({ headers: {}, rawBody: challenge, secret: 's', now, hook: { pending: true, secret: null } })).toEqual({ issues: [], handshake: { body: { challenge: 'c-123' } } });
  expect(monday.webhook({ headers: {}, rawBody: challenge, secret: 's', now, hook: { pending: false, secret: null } })).toBeNull();
});

it('a title pushed to Asana, monday.com or ClickUp writes only the title, so a field someone changed there in the meantime is not written over', async () => {
  const task = {
    gid: '1201',
    name: 'Old',
    html_notes: '<body>Edited in Asana a moment ago</body>',
    completed: false,
    due_on: '2026-12-01',
    memberships: [{ project: { gid: '900', name: 'Launch' }, section: { gid: '901', name: 'To do' } }],
    workspace: { gid: '1' },
  };
  const a = fakeConn('asana', (r) => ({ json: { data: r.method === 'GET' ? task : {} } }));
  const issue = { id: '1201', key: '1201', url: '', project: '900', values: { title: 'Old', description: '', labels: [] }, assigneeName: null, updatedAt: 0 } as RemoteIssue;
  await asana.updateIssue(a.conn, issue, { title: 'New' });
  const put = a.sent.filter((r) => r.method !== 'GET');
  expect(put).toEqual([{ method: 'PUT', path: '/tasks/1201', body: { data: { name: 'New' } } }]);

  const item = {
    id: '7001',
    name: 'Old',
    board: { id: '5001', name: 'Roadmap', columns: [{ id: 'status', title: 'Status', type: 'status', settings_str: '{"labels":{"0":"Working on it","1":"Done"},"done_colors":[1]}' }, { id: 'date4', title: 'Due', type: 'date' }], groups: [] },
    column_values: [{ id: 'status', type: 'status', text: 'Done', value: '{"index":1}' }],
    updates: [],
  };
  const m = fakeConn('monday', (r) => ({ json: { data: /items \(ids/.test(String((r.body as { query: string }).query)) ? { items: [item] } : { change_multiple_column_values: { id: '7001' } } } }));
  await monday.updateIssue(m.conn, { ...issue, id: '7001', key: '7001', project: '5001' }, { title: 'New' });
  const writes = m.sent.map((r) => r.body as { query: string; variables: Record<string, unknown> }).filter((b) => /mutation/.test(b.query));
  expect(writes).toHaveLength(1);
  expect(JSON.parse(String(writes[0].variables.values))).toEqual({ name: 'New' });

  // ClickUp: the title alone; an assignee change adds and removes those people, never sets the list.
  const cu = { id: '86a01', name: 'Old', markdown_description: 'Edited in ClickUp a moment ago', status: { status: 'to do', type: 'open' }, assignees: [{ id: 7, email: 'ann@x.test' }, { id: 8, email: 'bo@x.test' }], list: { id: '9017' } };
  const c = fakeConn('clickup', (r) => ({ json: r.path.startsWith('/list/9017/member') ? { members: [{ id: 9, email: 'cy@x.test' }] } : r.path.startsWith('/list/9017') ? { statuses: [] } : r.method === 'GET' ? cu : {} }));
  await clickup.updateIssue(c.conn, { ...issue, id: '86a01', key: '86a01', project: '9017' }, { title: 'New' });
  await clickup.updateIssue(c.conn, { ...issue, id: '86a01', key: '86a01', project: '9017' }, { assignee: 'cy@x.test' });
  expect(c.sent.filter((r) => r.method === 'PUT')).toEqual([
    { method: 'PUT', path: '/task/86a01', body: { name: 'New' } },
    { method: 'PUT', path: '/task/86a01', body: { assignees: { add: [9], rem: [7] } } },
  ]);
});

it('a ClickUp delivery is taken only when signed with the secret ClickUp named for that webhook', () => {
  const now = Date.now();
  const body = Buffer.from(JSON.stringify({ event: 'taskStatusUpdated', task_id: '86a1b2c3d', webhook_id: 'wh-1' }));
  const sig = (s: string, b = body) => createHmac('sha256', s).update(b).digest('hex');
  const hook = { pending: false, secret: 'NAMED-BY-CLICKUP' };
  expect(clickup.webhook({ headers: { 'x-signature': sig('NAMED-BY-CLICKUP') }, rawBody: body, secret: 's', now, hook })).toEqual({ issues: ['86a1b2c3d'] });
  // Signed with the connection's own secret, altered after signing, unsigned, or a webhook with no secret kept: refused.
  expect(clickup.webhook({ headers: { 'x-signature': sig('s') }, rawBody: body, secret: 's', now, hook })).toBeNull();
  expect(clickup.webhook({ headers: { 'x-signature': sig('NAMED-BY-CLICKUP') }, rawBody: Buffer.from(body.toString().replace('86a1b2c3d', '86a9')), secret: 's', now, hook })).toBeNull();
  expect(clickup.webhook({ headers: {}, rawBody: body, secret: 's', now, hook })).toBeNull();
  expect(clickup.webhook({ headers: { 'x-signature': sig('s') }, rawBody: body, secret: 's', now, hook: { pending: true, secret: null } })).toBeNull();
});

it('a card moved to the In progress column moves its done Asana task to that section and reopens it; a monday.com item takes the label of the column, by name', async () => {
  const task = {
    gid: '1201',
    name: 'Ship it',
    completed: true,
    memberships: [{ project: { gid: '900', name: 'Launch' }, section: { gid: '903', name: 'Done' } }],
    workspace: { gid: '1' },
  };
  const sections = [
    { gid: '901', name: 'To do' },
    { gid: '902', name: 'In progress' },
    { gid: '903', name: 'Done' },
  ];
  const a = fakeConn('asana', (r) => ({ json: { data: r.path.startsWith('/projects/900/sections') ? sections : r.method === 'GET' ? task : {} } }));
  const issue = { id: '1201', key: '1201', url: '', project: '900', values: { title: 'Ship it', description: '', labels: [] }, assigneeName: null, updatedAt: 0 } as RemoteIssue;
  await asana.updateIssue(a.conn, issue, { statusName: 'In progress', status: 'doing' });
  const writes = a.sent.filter((r) => r.method !== 'GET');
  expect(writes).toContainEqual({ method: 'POST', path: '/sections/902/addTask', body: { data: { task: '1201' } } });
  expect(writes).toContainEqual({ method: 'PUT', path: '/tasks/1201', body: { data: { completed: false } } });

  const item = {
    id: '7001',
    name: 'Ship it',
    board: { id: '5001', name: 'Roadmap', columns: [{ id: 'status', title: 'Status', type: 'status', settings_str: '{"labels":{"0":"Working on it","1":"Done","2":"Stuck"},"done_colors":[1]}' }], groups: [] },
    column_values: [{ id: 'status', type: 'status', text: 'Done', value: '{"index":1}' }],
    updates: [],
  };
  const m = fakeConn('monday', (r) => ({ json: { data: /items \(ids/.test(String((r.body as { query: string }).query)) ? { items: [item] } : { change_multiple_column_values: { id: '7001' } } } }));
  await monday.updateIssue(m.conn, { ...issue, id: '7001', key: '7001', project: '5001' }, { statusName: 'Stuck', status: 'doing' });
  const w = m.sent.map((r) => r.body as { query: string; variables: Record<string, unknown> }).find((b) => /change_multiple_column_values/.test(b.query))!;
  expect(JSON.parse(String(w.variables.values))).toEqual({ status: { label: 'Stuck' } });
  // Read back, the label marked done in the column's settings is done; another is in progress.
  const read = fakeConn('monday', (r) => ({ json: { data: /users/.test(String((r.body as { query: string }).query)) ? { users: [] } : { items: [{ ...item, column_values: [{ id: 'status', type: 'status', text: 'Stuck', value: '{"index":2}' }] }] } } }));
  expect((await monday.getIssue(read.conn, '7001'))?.values).toMatchObject({ statusName: 'Stuck', status: 'doing' });
});

it('a spent monday.com complexity budget is waited out when it resets in a moment and handed back as a wait otherwise, never read as an answer', async () => {
  const spent = (s: number) => ({ errors: [{ message: 'Complexity budget exhausted', extensions: { code: 'COMPLEXITY_BUDGET_EXHAUSTED', retry_in_seconds: s } }] });
  const answers = [spent(1), { data: { items: [] } }];
  const soon = fakeConn('monday', () => ({ json: answers.shift() }));
  expect(await monday.getIssue(soon.conn, '7001')).toBeNull();
  expect(soon.sent).toHaveLength(2);
  const later = fakeConn('monday', () => ({ json: spent(40) }));
  const err = await monday.getIssue(later.conn, '7001').catch((e) => e);
  expect(err).toBeInstanceOf(TrackerError);
  expect(err).toMatchObject({ kind: 'rate', retryAfterMs: 40_000 });
  expect(later.sent).toHaveLength(1);
});

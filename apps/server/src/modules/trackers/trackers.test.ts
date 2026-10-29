// Tracker sync at the seams where it can go wrong: the merge rule, descriptions in each tracker's
// format, webhook signatures, GitHub's managed section, writing a tracker's change back onto board
// items, and rate limits. End to end against mock trackers: `npm run verify -- --only tracker`.
import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { baseOf, mergeField, pullableFields, type BoardElement, type IssueValues, type KanbanElement, type Tag } from '@freero/shared';
import { planPull } from './board';
import { trackerRequest, TrackerError } from './http';
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

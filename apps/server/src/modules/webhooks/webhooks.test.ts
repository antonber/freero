// Webhooks end to end on real boards and a real HTTP receiver (in-memory Postgres): events flow
// from changes through the outbox and the stream into signed deliveries, only for boards the whole
// team can open, retried with backoff until an endpoint that keeps failing is turned off.
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import { EVENT_TYPES, WEBHOOK_HEADERS, webhookSignedPayload, type Account, type BoardElement } from '@freero/shared';
import { onOutboxMail } from '../../platform/mail';
import { drainOutbox, registerOutboxConsumer } from '../../platform/outbox';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { listAuditEvents } from '../audit/index';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { deriveDueBoards, EVENTS_CONSUMER, eventsConsumer } from '../events/index';
import { inviteBoardMember } from '../members/index';
import { changeBoard, initBoardDoc } from '../realtime/index';
import { createProject, createTeamWorkspace, inviteToWorkspace } from '../workspaces/index';
import { createEndpoint, deliverDue, listDeliveries, updateEndpoint, webhooksConsumer } from './service';

const SCHEMA = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../docs/events.schema.json'), 'utf8'));

beforeAll(async () => {
  // The receiver runs on this machine; retries fast so the test needn't wait.
  await openTestDb({ PUBLIC_URL: 'http://freero.test', WEBHOOK_PRIVATE_ENDPOINTS: 'true', WEBHOOK_RETRY_BASE_MS: '10', WEBHOOK_DISABLE_AFTER_FAILURES: '3' });
  registerOutboxConsumer(eventsConsumer);
  registerOutboxConsumer(webhooksConsumer);
});
afterAll(() => closeTestDb());

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@webhooks.test.freero.app`, password: 'password-123' }, { emailVerified: true });

interface Received {
  headers: http.IncomingHttpHeaders;
  body: string;
}
async function receiver() {
  const got: Received[] = [];
  let status = 200;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      got.push({ headers: req.headers, body });
      res.statusCode = status;
      if (status === 302) res.setHeader('location', 'http://127.0.0.1:9/elsewhere');
      res.end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`,
    got,
    answer: (s: number) => (status = s),
    close: () => new Promise((r) => server.close(r)),
  };
}

const sticky = (id: string, text: string, createdBy: string): BoardElement =>
  ({ id, type: 'sticky', x: 0, y: 0, w: 100, h: 100, rotation: 0, z: 1, createdBy, createdAt: 1, updatedAt: 1, text, color: 'yellow' }) as BoardElement;
async function save(boardId: string, elements: BoardElement[]) {
  const doc = new Y.Doc();
  for (const e of elements) doc.getMap('elements').set(e.id, e);
  await initBoardDoc(boardId, Y.encodeStateAsUpdate(doc));
}
/** Everything raised so far: recorded, compared as settled, fanned out and sent (each due attempt once). */
async function flow(at = Date.now()) {
  await drainOutbox(EVENTS_CONSUMER);
  await deriveDueBoards(at + 3600_000);
  await drainOutbox('webhooks');
  await deliverDue(at + 3600_000);
}
const verifies = (secret: string, r: Received) => {
  const [t, v1] = String(r.headers[WEBHOOK_HEADERS.signature]).split(',').map((p) => p.split('=')[1]);
  return createHmac('sha256', secret).update(webhookSignedPayload(Number(t), r.body)).digest('hex') === v1;
};

/** A small check of a delivered event against the documented contract (docs/events.schema.json). */
function contractProblems(event: Record<string, unknown>): string[] {
  const out: string[] = [];
  const typeOk = (v: unknown, t: unknown) => [t].flat().some((x) => (x === 'null' ? v === null : x === 'object' ? !!v && typeof v === 'object' : typeof v === x));
  const check = (v: Record<string, unknown>, s: { required?: string[]; properties?: Record<string, { type?: unknown; enum?: unknown[]; $ref?: string }> }, at: string) => {
    for (const k of s.required ?? []) if (!(k in v)) out.push(`${at}.${k} missing`);
    for (const [k, p] of Object.entries(s.properties ?? {})) {
      if (!(k in v)) continue;
      if (p.$ref) check(v[k] as Record<string, unknown>, SCHEMA.item, `${at}.${k}`);
      else if (p.enum && !p.enum.includes(v[k])) out.push(`${at}.${k} not in enum`);
      else if (p.type && !typeOk(v[k], p.type)) out.push(`${at}.${k} has the wrong type`);
    }
  };
  check(event, SCHEMA.envelope, '$');
  const data = SCHEMA.data[event.type as string];
  if (!data) out.push(`undocumented type ${String(event.type)}`);
  else check(event.data as Record<string, unknown>, data, '$.data');
  return out;
}

it('every event type is documented in the contract, and nothing documented is gone', () => {
  expect(Object.keys(SCHEMA.data).sort()).toEqual(Object.keys(EVENT_TYPES).sort());
});

it('an endpoint gets one signed delivery per event it wants, only about boards the whole team can open, and a Slack endpoint a message whose board text can’t format or ping', async () => {
  const [owner, mate, other] = await Promise.all([user('Owner'), user('Mate'), user('Other')]);
  const ws = await createTeamWorkspace(owner.id, 'Studio');
  await inviteToWorkspace(null, ws.id, owner, { email: mate.email, role: 'member' });
  const secretProject = await createProject(ws.id, owner.id, { name: 'Board of directors', access: 'private' });
  const open = await createBoard(owner.id, 'Roadmap', '', 'none', { workspaceId: ws.id });
  const hidden = await createBoard(owner.id, 'Salaries', '', 'none', { workspaceId: ws.id, projectId: secretProject.id });
  const personal = await createBoard(owner.id, 'My diary', '');
  const json = await receiver();
  const slack = await receiver();
  try {
    // Only owners and admins manage webhooks.
    await expect(createEndpoint(ws.id, mate.id, { url: json.url, events: ['item.created'] })).rejects.toMatchObject({ status: 403 });
    const { secret } = await createEndpoint(ws.id, owner.id, { url: json.url, events: ['item.created', 'member.added'] });
    await createEndpoint(ws.id, owner.id, { url: slack.url, events: ['item.created'], format: 'slack' });
    await flow(); // board.created events of the three boards: nobody asked for them

    await save(open.id, [sticky('a', '<p>&lt;!channel&gt; see &lt;https://evil.example|your bank&gt; *now*</p>', owner.id)]);
    await save(hidden.id, [sticky('b', 'pay rise for Mate', owner.id)]);
    await save(personal.id, [sticky('c', 'dear diary', owner.id)]);
    await inviteBoardMember(null, open.id, owner, { email: other.email, role: 'viewer' });
    await flow();

    const events = json.got.map((r) => JSON.parse(r.body) as Record<string, unknown>);
    expect(events.map((e) => e.type).sort()).toEqual(['item.created', 'member.added']);
    expect(json.got.every((r) => verifies(secret, r))).toBe(true);
    expect(json.got.every((r) => !verifies('whsec_wrong', r))).toBe(true);
    for (const e of events) expect(contractProblems(e)).toEqual([]);
    expect(JSON.stringify(events)).not.toMatch(/Salaries|pay rise|diary/);
    expect(events.find((e) => e.type === 'member.added')).toMatchObject({ board: { id: open.id, title: 'Roadmap' }, actor: { kind: 'user', id: owner.id, name: 'Owner' } });

    // Replaying the fan-out sends nothing twice.
    await drainOutbox('webhooks');
    await deliverDue(Date.now() + 7200_000);
    expect(json.got).toHaveLength(2);

    expect(slack.got).toHaveLength(1);
    const message = JSON.parse(slack.got[0].body) as { text: string; blocks: Array<{ text: { text: string } }> };
    const text = message.blocks[0].text.text;
    expect(text).toContain('Owner added a sticky note to <http://freero.test/board/');
    expect(text).not.toMatch(/<!channel>|<https:\/\/evil/);
    expect(text).toContain('&lt;!channel&gt;');

    // Configuration changes are audited — never with the secret.
    const audit = await listAuditEvents({ workspaceId: ws.id }, 100);
    expect(audit.filter((e) => e.action.startsWith('webhook.')).map((e) => e.action)).toEqual(['webhook.created', 'webhook.created']);
    expect(JSON.stringify(audit)).not.toContain(secret);
  } finally {
    await json.close();
    await slack.close();
  }
});

it('a failing receiver is retried with backoff, a redirect is a failure that is never followed, and after three failures in a row the endpoint turns off — audited, its creator told — until an admin turns it back on', async () => {
  const owner = await user('Keeper');
  const ws = await createTeamWorkspace(owner.id, 'Ops');
  const b = await createBoard(owner.id, 'Incidents', '', 'none', { workspaceId: ws.id });
  const r = await receiver();
  const mails: string[] = [];
  const stop = onOutboxMail((m) => mails.push(`${m.to} ${m.subject}`));
  try {
    const { endpoint } = await createEndpoint(ws.id, owner.id, { url: r.url, events: ['item.created'] });
    r.answer(500);
    await save(b.id, [sticky('x', 'outage', owner.id)]);
    await drainOutbox(EVENTS_CONSUMER);
    await deriveDueBoards(Date.now() + 3600_000);
    await drainOutbox('webhooks');
    const t = Date.now();
    await deliverDue(t); // attempt 1: 500
    await deliverDue(t); // not due yet: no attempt
    expect(r.got).toHaveLength(1);
    r.answer(302);
    await deliverDue(t + 20); // attempt 2 (due after 10 ms): a redirect
    expect((await listDeliveries(ws.id, owner.id, endpoint.id))[0]).toMatchObject({ status: 'pending', attempts: 2, error: expect.stringMatching(/redirect/) });
    r.answer(500);
    await deliverDue(t + 100); // attempt 3 (due after 40 ms more): the endpoint turns off
    await deliverDue(t + 3600_000);
    expect(r.got).toHaveLength(3);
    expect((await updateEndpoint(ws.id, owner.id, endpoint.id, {})).enabled).toBe(false);
    expect((await listAuditEvents({ workspaceId: ws.id }, 100)).some((e) => e.action === 'webhook.disabled')).toBe(true);
    await expect.poll(() => mails.some((m) => m.startsWith(owner.email) && /turned off/.test(m))).toBe(true);

    r.answer(200);
    await updateEndpoint(ws.id, owner.id, endpoint.id, { enabled: true });
    await deliverDue(t + 7200_000);
    expect(r.got).toHaveLength(4);
    expect((await listDeliveries(ws.id, owner.id, endpoint.id))[0]).toMatchObject({ status: 'delivered', attempts: 4, responseStatus: 200 });
  } finally {
    stop();
    await r.close();
  }
});

it('an endpoint scoped to an agent’s lane gets only what happens in it — its cards, comments on them, a card deleted from it — and only a board the whole team can open may be its scope', async () => {
  const owner = await user('Lead');
  const ws = await createTeamWorkspace(owner.id, 'Agents');
  const b = await createBoard(owner.id, 'Control room', '', 'none', { workspaceId: ws.id });
  const personal = await createBoard(owner.id, 'Mine', '');
  const r = await receiver();
  try {
    const events = ['item.created', 'item.updated', 'item.deleted', 'comment.created'];
    await expect(createEndpoint(ws.id, owner.id, { url: r.url, events, scope: `freero://board/${personal.id}` })).rejects.toMatchObject({ status: 400 });
    // The lane's kanban, as an item's copied link names it.
    await createEndpoint(ws.id, owner.id, { url: r.url, events, scope: `http://freero.test/board/${b.id}?el=lane` });
    await flow();
    const lane = { ...sticky('lane', '', owner.id), type: 'kanban', title: 'Tasks · Builder', columns: [], colW: 260 } as unknown as BoardElement;
    const card = { ...sticky('c1', '', owner.id), type: 'card', title: 'Fix login', description: '', color: '#5B3FF0', frameId: 'lane' } as unknown as BoardElement;
    await save(b.id, [lane, card, sticky('other', 'not the lane', owner.id)]);
    await flow();
    const actor = { userId: owner.id, role: 'owner' as const, name: 'Lead' };
    await changeBoard(b.id, actor, () => ({
      change: {
        update: [{ id: 'other', patch: { text: 'still not the lane' } }],
        collections: {
          comments: {
            't:th': { kind: 'thread', id: 'th', x: 0, y: 0, elementId: 'c1', createdAt: 2, createdBy: owner.id },
            'm:th:m1': { kind: 'message', threadId: 'th', id: 'm1', authorId: owner.id, authorName: 'Lead', text: 'Try the staging key', createdAt: 2 },
            't:th2': { kind: 'thread', id: 'th2', x: 0, y: 0, elementId: 'other', createdAt: 2, createdBy: owner.id },
            'm:th2:m1': { kind: 'message', threadId: 'th2', id: 'm1', authorId: owner.id, authorName: 'Lead', text: 'elsewhere', createdAt: 2 },
          },
        },
      },
    }));
    await flow();
    await changeBoard(b.id, actor, () => ({ change: { remove: ['c1'] } }));
    await flow();
    const got = r.got.map((x) => JSON.parse(x.body) as { type: string; data: { item?: { id: string }; itemId?: string } });
    expect(got.map((e) => `${e.type} ${e.data.item?.id ?? e.data.itemId}`).sort()).toEqual(['comment.created c1', 'item.created c1', 'item.created lane', 'item.deleted c1']);
  } finally {
    await r.close();
  }
});

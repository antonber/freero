// Tracker links racing with requests and with the tracker, against the repo's mock GitHub
// (scripts/lib/mock-github.mjs): a send clicked twice, an unlink or a removed connection while a
// sync is in flight, an import while the board's other changes are synced, credentials taken back
// mid-sync, an issue deleted in the tracker, and a webhook registration outrun by a switch to polling.
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { TRACKER_COLLECTION, type Account, type BoardElement, type TrackerIssueRecord } from '@freero/shared';
// @ts-expect-error -- a plain .mjs test double without types
import { startMockGithub } from '../../../../../scripts/lib/mock-github.mjs';
import { seal } from '../../platform/secrets';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { BOARD_CONTENT_TOPIC, initBoardDoc, readBoardView } from '../realtime/index';
import { createConnection, CREDENTIALS_PURPOSE, deleteConnectionRecord, openConnection } from './connections';
import { dropWebhooks, ensureWebhooks } from './hooks';
import { github } from './providers/github';
import { jiraOAuth } from './providers/jira';
import * as repo from './repo';
import { importIssues, markDisconnected, sendToTracker, syncLink, trackersConsumer, unlink } from './service';

/** Runs once before the next board write of a tracker request (the write is slow: a sync runs meanwhile). */
let beforeNextBoardWrite: ((boardId: string) => Promise<void>) | null = null;
vi.mock('../realtime/index', async (load) => {
  const real = await load<typeof import('../realtime/index')>();
  return {
    ...real,
    changeBoard: (async (boardId, actor, plan) => {
      const hook = beforeNextBoardWrite;
      beforeNextBoardWrite = null;
      if (hook) await hook(boardId);
      return real.changeBoard(boardId, actor, plan);
    }) as typeof real.changeBoard,
  };
});

const ORIGIN = 'http://freero.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let gh: any;
beforeAll(async () => {
  await openTestDb({ PUBLIC_URL: ORIGIN, TRACKER_PRIVATE_ENDPOINTS: 'true', TRACKER_JIRA_CLIENT_ID: 'freero-test', TRACKER_JIRA_CLIENT_SECRET: 'oauth-secret' });
  gh = await startMockGithub();
});
afterAll(async () => {
  await gh?.close();
  await closeTestDb();
});

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@links.test.freero.app`, password: 'password-123' }, { emailVerified: true });

async function setup(repoName: string) {
  const owner = await user('Linker');
  const board = await createBoard(owner.id, 'Sync board', '');
  const { connection } = await createConnection(owner.id, { provider: 'github', name: `GitHub ${repoName}`, site: gh.url, token: gh.token, defaults: { project: repoName } }, null);
  return { owner, board, connection };
}

/** An issue made on GitHub, imported onto the board as a linked card. */
async function imported(repoName: string) {
  const s = await setup(repoName);
  const number = gh.create(repoName, { title: 'Checkout bug' });
  const r = await importIssues(s.owner.id, s.board.id, { connectionId: s.connection.id, query: `repo:${repoName}` }, ORIGIN);
  return { ...s, number, linkId: r.cards![0]!.linkId, cardId: r.cards![0]!.id };
}

/** Holds the next `github.getIssue` (a sync reading the issue) until released. */
function holdIssueRead() {
  const orig = github.getIssue;
  let release!: () => void;
  const gate = new Promise<void>((res) => (release = res));
  let first = true;
  github.getIssue = async (...a: Parameters<typeof orig>) => {
    if (first) {
      first = false;
      await gate;
    }
    return orig(...a);
  };
  return {
    release: () => {
      release();
      github.getIssue = orig;
    },
  };
}

const settle = () => new Promise((res) => setTimeout(res, 50));

async function boardOf(boardId: string, ownerId: string, linkId: string, cardId: string) {
  const view = await readBoardView(boardId, { userId: ownerId, role: 'owner' });
  const card = view.elements.find((e) => e.el.id === cardId)?.el as (BoardElement & { trackerLink?: string | null }) | undefined;
  return { badge: (view.collection(TRACKER_COLLECTION).get(linkId) as TrackerIssueRecord | undefined) ?? null, mark: card?.trackerLink ?? null, card: !!card };
}

it('sending the same items twice at once (a double click, an agent retrying sync_to_tracker) creates one issue in the tracker, not an unlinked duplicate', async () => {
  const { owner, board, connection } = await setup('acme/send');
  gh.create('acme/send', { title: 'An issue people made earlier' }); // the repository exists
  const doc = new Y.Doc();
  doc.getMap('elements').set('s1', { id: 's1', type: 'sticky', x: 0, y: 0, w: 100, h: 100, rotation: 0, z: 1, createdBy: owner.id, createdAt: 1, updatedAt: 1, text: 'Refund flow is slow', color: 'yellow' });
  await initBoardDoc(board.id, Y.encodeStateAsUpdate(doc));
  const body = { connectionId: connection.id, itemIds: ['s1'], project: 'acme/send' };
  const out = await Promise.allSettled([sendToTracker(owner.id, board.id, body, ORIGIN), sendToTracker(owner.id, board.id, body, ORIGIN)]);
  expect(out.map((o) => o.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect(gh.requests.filter((q: { method: string; path: string }) => q.method === 'POST' && /\/repos\/acme\/send\/issues$/.test(q.path))).toHaveLength(1);
  const sent = out.find((o) => o.status === 'fulfilled')!.value.issues[0]!;
  expect(await boardOf(board.id, owner.id, sent.linkId, 's1')).toMatchObject({ badge: { state: 'ok', key: sent.key }, mark: sent.linkId });
});

it('an issue unlinked while its sync is writing the board leaves no badge or link mark there', async () => {
  const { owner, board, linkId, cardId } = await imported('acme/unlink');
  // The sync has read both sides and written the issue; the person unlinks it just before the sync's board write lands.
  beforeNextBoardWrite = () => unlink(owner.id, board.id, linkId);
  await syncLink(linkId);
  expect(beforeNextBoardWrite).toBeNull();

  expect(await repo.getLink(linkId)).toBeNull();
  expect(await boardOf(board.id, owner.id, linkId, cardId)).toMatchObject({ badge: null, mark: null, card: true });
});

it('an issue unlinked while its sync is reading it keeps no link back to the card that the sync would add afterwards', async () => {
  const { owner, board, linkId, cardId, number } = await imported('acme/unlink-read');
  const held = holdIssueRead();
  const sync = syncLink(linkId);
  await settle();
  await unlink(owner.id, board.id, linkId);
  held.release();
  await sync;

  expect(gh.issue('acme/unlink-read', number).body).not.toContain(cardId);
});

it('a connection removed while one of its syncs is writing the board leaves the badge saying it is disconnected, not synced', async () => {
  const { owner, board, connection, linkId, cardId } = await imported('acme/removed');
  // What DELETE /trackers/connections/:id does, just before the sync's board write lands.
  beforeNextBoardWrite = async () => {
    const removed = await deleteConnectionRecord(connection.id, owner.id);
    await markDisconnected(removed.connection, removed.links);
  };
  await syncLink(linkId);
  expect(beforeNextBoardWrite).toBeNull();

  expect(await boardOf(board.id, owner.id, linkId, cardId)).toMatchObject({ badge: { state: 'disconnected' }, mark: linkId });
});

it('a card imported while a sync of the same board runs keeps its link: the sync does not take the card, not written yet, for one deleted', async () => {
  const { owner, board, connection } = await setup('acme/import');
  // The board has saved content: the trackers consumer reads it for every saved change.
  const doc = new Y.Doc();
  doc.getMap('elements').set('n1', { id: 'n1', type: 'sticky', x: 0, y: 0, w: 100, h: 100, rotation: 0, z: 1, createdBy: owner.id, createdAt: 1, updatedAt: 1, text: 'Notes', color: 'yellow' });
  await initBoardDoc(board.id, Y.encodeStateAsUpdate(doc));
  gh.create('acme/import', { title: 'Checkout bug' });
  // Someone else's change of the board is synced just as the import writes its cards.
  beforeNextBoardWrite = (boardId) => trackersConsumer.handle([{ id: 1, topic: BOARD_CONTENT_TOPIC, key: `board:${boardId}`, payload: null, createdAt: Date.now() }], { version: 1 });
  const r = await importIssues(owner.id, board.id, { connectionId: connection.id, query: 'repo:acme/import' }, ORIGIN);
  expect(beforeNextBoardWrite).toBeNull();
  const { linkId, id: cardId } = r.cards![0]!;

  expect(await repo.getLink(linkId)).toMatchObject({ state: 'ok', sources: [cardId] });
  expect(await boardOf(board.id, owner.id, linkId, cardId)).toMatchObject({ badge: { state: 'ok' }, mark: linkId });
});

it('a personal connection signed out everywhere still says to connect it again after a sync that was in flight finishes and after a later sync', async () => {
  const { owner, connection, linkId } = await imported('acme/revoked');
  const held = holdIssueRead();
  const sync = syncLink(linkId);
  await settle();
  await repo.revokePersonalCredentials(owner.id);
  held.release();
  await sync;
  expect(await repo.getConnection(connection.id)).toMatchObject({ status: 'needs_auth', credentialsSealed: null });

  await syncLink(linkId);
  expect(await repo.getConnection(connection.id)).toMatchObject({ status: 'needs_auth', credentialsSealed: null });
});

it('an OAuth token refresh in flight when the owner is signed out everywhere does not bring the revoked credentials back', async () => {
  const owner = await user('Refresher');
  const id = `conn-refresh-${n}`;
  const expired = { kind: 'oauth' as const, accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: Date.now() - 1000 };
  await repo.insertConnection({
    id,
    workspaceId: null,
    ownerId: owner.id,
    provider: 'jira',
    name: 'Jira',
    site: 'http://127.0.0.1:9',
    apiBase: 'http://127.0.0.1:9',
    deployment: 'cloud',
    auth: 'oauth',
    credentialsSealed: seal(CREDENTIALS_PURPOSE, JSON.stringify(expired)),
    webhookSecretSealed: null,
    inbound: 'polling',
    settings: {},
    status: 'active',
    lastError: null,
    createdBy: owner.id,
    createdAt: Date.now(),
  });
  const orig = jiraOAuth.refresh;
  // Atlassian answers the refresh only after the owner was signed out everywhere.
  jiraOAuth.refresh = async () => {
    await repo.revokePersonalCredentials(owner.id);
    return { kind: 'oauth', accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: Date.now() + 3_600_000 };
  };
  try {
    await openConnection((await repo.getConnection(id))!)
      .call({ method: 'GET', path: '/rest/api/3/myself' })
      .catch(() => undefined);
  } finally {
    jiraOAuth.refresh = orig;
  }

  expect(await repo.getConnection(id)).toMatchObject({ credentialsSealed: null, status: 'needs_auth' });
});

it('a linked issue deleted in the tracker stops being retried after a few tries, and its badge says it is gone', async () => {
  const { owner, board, linkId, cardId, number } = await imported('acme/deleted');
  await syncLink(linkId);
  gh.remove('acme/deleted', number);
  for (let i = 0; i < 5; i++) await syncLink(linkId);

  expect(await repo.getLink(linkId)).toMatchObject({ state: 'error', retryAt: null });
  expect((await boardOf(board.id, owner.id, linkId, cardId)).badge).toMatchObject({ state: 'error', note: expect.stringMatching(/no longer exists in GitHub.*no longer syncs/) });
});

it('a webhook registration that finishes after the connection switched to polling is undone in the tracker, never left active', async () => {
  const { connection } = await setup('acme/hooks');
  const conn = (await repo.getConnection(connection.id))!;
  let registered!: () => void;
  const registering = new Promise<void>((res) => (registered = res));
  let answer!: () => void;
  const answered = new Promise<void>((res) => (answer = res));
  const unregistered: string[] = [];
  github.webhooks = {
    signed: false,
    async register() {
      registered();
      await answered;
      return { id: 'hook-1' };
    },
    async unregister(_pc, id) {
      unregistered.push(id);
    },
  };
  try {
    const ensuring = ensureWebhooks(conn, ['acme/hooks'], ORIGIN);
    await registering;
    // What PATCH /trackers/connections/:id { inbound: 'polling' } does meanwhile.
    const polling = (await repo.updateConnection(conn.id, { inbound: 'polling' }))!;
    await dropWebhooks(polling, await repo.hooksOfConnection(conn.id), 'The connection polls instead.');
    answer();
    await ensuring;
  } finally {
    delete github.webhooks;
  }

  expect((await repo.hooksOfConnection(conn.id)).map((h) => h.state)).toEqual(['failed']);
  expect(unregistered).toEqual(['hook-1']);
});

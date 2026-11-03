// IP allowlists (#156): a workspace's boards open only from its networks — on requests and on an open
// socket — and its organisation's list applies too; the admin console stays reachable from anywhere,
// so an owner can always fix a wrong list; a list leaving out your own address needs a confirmation;
// API credentials pass from elsewhere only where exempted.
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import type { Account } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { runWithRequestContext } from '../../platform/requestContext';
import { createPersonalToken, setCredentialIpExempt, useInWorkspace, type ApiCredential } from '../apiauth/index';
import { createUser } from '../auth/index';
import { createBoard, getBoardAccess } from '../boards/index';
import { admitSocket } from '../realtime/index';
import { attachWorkspace, createOrganisation } from './index';
import { createTeamWorkspace, listWorkspaces, updateSettings } from './service';

const OFFICE = '10.20.30.40';
const CAFE = '203.0.113.9';
const from = <T>(ip: string, fn: () => Promise<T>): Promise<T> => runWithRequestContext({ reqId: `test-${ip}`, userId: null, ip, userAgent: null }, fn);

let wss: WebSocketServer;
let url = '';
let admitAs: { userId: string; boardId: string; ip: string } | null = null;

beforeAll(async () => {
  await openTestDb();
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  wss.on('connection', (ws) => {
    const who = admitAs!;
    // As the platform does for an upgrade: the socket's request context carries its address.
    void from(who.ip, () =>
      admitSocket(ws, `s-${who.userId}`, async () => ({
        boardId: who.boardId,
        userId: who.userId,
        role: (await getBoardAccess(who.boardId, who.userId)).role ?? 'viewer',
        sessionKey: `s-${who.userId}`,
        identity: { id: who.userId, name: 'Someone', color: '#1C7ED6', avatarUrl: null },
      })),
    );
  });
  url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => wss.close(r));
  await closeTestDb();
});

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@ip.test.freero.app`, password: 'password-123' }, { emailVerified: true });

it('a workspace’s boards open only from its networks, on requests and on an open socket, while its owner can still fix the list from anywhere', async () => {
  const owner = await user('Owner');
  const ws = (await createTeamWorkspace(owner.id, `Team ${++n}`)).id;
  const board = await createBoard(owner.id, 'Plans', '', 'none', { workspaceId: ws });
  await from(OFFICE, () => updateSettings(ws, owner.id, { ipAllowlist: ['10.0.0.0/8'] }));

  expect((await from(OFFICE, () => getBoardAccess(board.id, owner.id))).role).toBe('owner');
  expect((await from(CAFE, () => getBoardAccess(board.id, owner.id))).role).toBeNull();
  expect((await from(CAFE, () => listWorkspaces(owner.id))).find((w) => w.id === ws)?.blocked).toBe('ip_not_allowed');

  // A socket opened from the office closes once the office is no longer on the list.
  admitAs = { userId: owner.id, boardId: board.id, ip: OFFICE };
  const socket = new WebSocket(`${url}/${board.id}`);
  await new Promise<void>((resolve, reject) => (socket.once('open', () => resolve()), socket.once('error', reject)));
  const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
  await new Promise((r) => setTimeout(r, 100));
  await from(CAFE, () => updateSettings(ws, owner.id, { ipAllowlist: ['192.168.0.0/16'], confirmExcludesMe: true }));
  expect(await closed).toBe(4403);

  // Locked out of the boards, not out of the console: the owner clears the list from the café.
  await from(CAFE, () => updateSettings(ws, owner.id, { ipAllowlist: [] }));
  expect((await from(CAFE, () => getBoardAccess(board.id, owner.id))).role).toBe('owner');
});

it('saving a list that leaves out your own address needs a confirmation, and nonsense ranges are refused', async () => {
  const owner = await user('Owner');
  const ws = (await createTeamWorkspace(owner.id, `Team ${++n}`)).id;
  await expect(from(CAFE, () => updateSettings(ws, owner.id, { ipAllowlist: ['10.0.0.0/8'] }))).rejects.toMatchObject({ status: 409, code: 'ip_allowlist_excludes_you' });
  await expect(from(CAFE, () => updateSettings(ws, owner.id, { ipAllowlist: ['10.0.0.0/33'] }))).rejects.toMatchObject({ status: 400 });
  await expect(from(CAFE, () => updateSettings(ws, owner.id, { ipAllowlist: ['10.0.0.0/8'], confirmExcludesMe: true }))).resolves.toMatchObject({ ipAllowlist: ['10.0.0.0/8'] });
});

it('an organisation’s list applies to its workspaces besides their own', async () => {
  const owner = await user('Owner');
  const ws = (await createTeamWorkspace(owner.id, `Team ${++n}`)).id;
  const board = await createBoard(owner.id, 'Plans', '', 'none', { workspaceId: ws });
  const org = await createOrganisation(owner.id, `Org ${++n}`);
  await attachWorkspace(org.id, ws, owner.id);
  await from(OFFICE, () => updateSettings(org.id, owner.id, { ipAllowlist: ['10.0.0.0/8'] }));
  expect((await from(CAFE, () => getBoardAccess(board.id, owner.id))).role).toBeNull();
  // The workspace's own list narrows it further; neither can widen the other.
  await from(OFFICE, () => updateSettings(ws, owner.id, { ipAllowlist: ['10.20.0.0/16'] }));
  expect((await from('10.99.0.1', () => getBoardAccess(board.id, owner.id))).role).toBeNull();
  expect((await from(OFFICE, () => getBoardAccess(board.id, owner.id))).role).toBe('owner');
});

it('an API token reaches the workspace from outside its networks only once its admins exempt it there', async () => {
  const owner = await user('Owner');
  const ws = (await createTeamWorkspace(owner.id, `Team ${++n}`)).id;
  await from(OFFICE, () => updateSettings(ws, owner.id, { ipAllowlist: ['10.0.0.0/8'] }));
  const { token } = await createPersonalToken(owner.id, 'password', { name: 'Nightly export', scopes: ['boards:read'], expiresInDays: 30 });
  const cred = { credentialId: token.id, kind: 'personal', label: token.name, scopes: ['boards:read'], account: { id: owner.id } } as unknown as ApiCredential;

  await expect(from(CAFE, () => useInWorkspace(cred, ws))).rejects.toMatchObject({ status: 403, code: 'ip_not_allowed' });
  await from(OFFICE, () => useInWorkspace(cred, ws));
  await setCredentialIpExempt(ws, owner.id, token.id, true);
  await expect(from(CAFE, () => useInWorkspace(cred, ws))).resolves.toBeUndefined();
});

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser, getAccount } from '../auth/index';
import { createBoard } from '../boards/index';
import type { BoardChangeEvent, ElementChange } from '../realtime/index';
import { createProject, createTeamWorkspace, inviteToWorkspace } from '../workspaces/index';
import { getConfig } from '../../platform/config';
import { boardActivity, flushBursts, recordChanges, recordComment, workspaceActivity } from './service';

beforeAll(() => openTestDb());
const IDLE_MS = () => getConfig().activityIdleMs;
afterAll(() => closeTestDb());

let n = 0;
const person = async (name: string): Promise<Account> =>
  getAccount((await createUser({ name, email: `${name.toLowerCase()}-${++n}@act.test.freero.app`, password: 'password-123' }, { emailVerified: true })).id);

const change = (id: string, op: ElementChange['op'], type = 'sticky', frameId: string | null = 'f1'): ElementChange => ({ id, op, type, frameId });
const event = (boardId: string, actor: Account, changes: ElementChange[], layer: BoardChangeEvent['layer'] = 'shared'): BoardChangeEvent => ({
  boardId,
  actorId: actor.id,
  actorName: actor.name,
  layer,
  changes,
  frameTitles: { f1: 'Ideas' },
});

it('a burst becomes one entry with net counts — what was added and removed again, or only moved into a hidden frame, is not news', async () => {
  const ann = await person('Ann');
  const board = await createBoard(ann.id, 'Retro', '', 'viewer');
  const t0 = Date.now();
  recordChanges(event(board.id, ann, [change('s1', 'add'), change('s2', 'add'), change('x', 'add')]), t0);
  recordChanges(event(board.id, ann, [change('s1', 'change'), change('x', 'remove'), change('old', 'remove', 'shape')]), t0 + 1000);
  // An older sticky moved into a hidden frame: gone from the shared doc, added to the editors layer.
  recordChanges(event(board.id, ann, [change('earlier', 'remove')]), t0 + 2000);
  recordChanges(event(board.id, ann, [change('earlier', 'add', 'sticky', 'f1')], 'editors'), t0 + 2000);
  recordComment({ boardId: board.id, authorId: ann.id, threadId: 't', messageId: 'm', text: 'hi', previousText: null, participantIds: [] }, 'Ann', t0 + 3000);
  await flushBursts(t0 + 2000 + IDLE_MS() - 1);
  expect((await boardActivity(board.id, ann.id)).entries).toEqual([]); // still going
  await flushBursts(t0 + 3000 + IDLE_MS());

  const texts = (await boardActivity(board.id, ann.id)).entries.map((e) => e.text);
  expect(texts).toContain('added 2 sticky notes and removed 1 shape in frame “Ideas”');
  expect(texts).toContain('commented');
  expect(texts.join(' ')).not.toContain('hidden');
});

it('a viewer never sees activity inside hidden frames; an editor does', async () => {
  const [owner, viewer] = await Promise.all([person('Owner'), person('Viewer')]);
  const board = await createBoard(owner.id, 'Launch', '', 'viewer');
  const t0 = Date.now();
  recordChanges(event(board.id, owner, [change('secret1', 'add'), change('secret2', 'add')], 'editors'), t0);
  await flushBursts(t0 + IDLE_MS());
  expect((await boardActivity(board.id, viewer.id)).entries).toEqual([]);
  expect((await boardActivity(board.id, owner.id)).entries.map((e) => e.text)).toEqual(['added 2 sticky notes in frame “Ideas” (hidden from viewers)']);
});

it('the workspace feed lists activity only from boards the reader can open', async () => {
  const [lead, member] = await Promise.all([person('Lead'), person('Member')]);
  const ws = await createTeamWorkspace(lead.id, 'Crew');
  await inviteToWorkspace(null, ws.id, lead, { email: member.email, role: 'member' });
  const secret = await createProject(ws.id, lead.id, { name: 'Secret', access: 'private' });
  const open = await createBoard(lead.id, 'Open board', '', 'none', { workspaceId: ws.id });
  const closed = await createBoard(lead.id, 'Closed board', '', 'none', { workspaceId: ws.id, projectId: secret.id });
  const t0 = Date.now();
  recordChanges(event(open.id, lead, [change('a', 'add', 'shape', null)]), t0);
  recordChanges(event(closed.id, lead, [change('b', 'add', 'shape', null)]), t0);
  await flushBursts(t0 + IDLE_MS());

  const feed = (await workspaceActivity(ws.id, member.id)).entries;
  expect(feed.map((e) => [e.boardTitle, e.actorName, e.text])).toEqual([['Open board', 'Lead', 'added 1 shape']]);
  expect((await workspaceActivity(ws.id, lead.id)).entries).toHaveLength(2);
});

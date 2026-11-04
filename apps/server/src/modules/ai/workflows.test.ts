// Saved AI workflows (#1) against a stub model endpoint (OpenAI chat-completions format) that
// answers whatever a test tells it to, on real boards in an in-memory Postgres, through the same
// service the routes use. Never a real provider.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { Account, BoardElement } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { initBoardDoc, readBoardView } from '../realtime/index';
import { createTeamWorkspace, inviteToWorkspace } from '../workspaces/index';
import { updateAiSettings } from './settings';
import { createWorkflow, listWorkflows, runWorkflow, updateWorkflow } from './workflows';

const seen: Array<{ messages: Array<{ role: string; content: string }> }> = [];
let replies: string[] = [];
let stub: http.Server;

beforeAll(async () => {
  stub = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push(JSON.parse(raw));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: replies.shift() ?? '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 200, completion_tokens: 40 } }));
    });
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  await openTestDb({
    AI_PROVIDER: 'openai',
    AI_BASE_URL: `http://127.0.0.1:${(stub.address() as AddressInfo).port}/v1`,
    AI_MODEL: 'stub-model',
    AI_INSTANCE_FOR: 'teams',
    RATE_LIMITS: 'off',
  });
});
afterAll(async () => {
  await closeTestDb();
  await new Promise((r) => stub.close(r));
});
beforeEach(() => {
  seen.length = 0;
  replies = [];
});

let n = 0;
const user = (name: string): Promise<Account> =>
  createUser({ name, email: `${name.toLowerCase()}-${++n}@workflows.test.freero.app`, password: 'password-123' }, { emailVerified: true });

let z = 0;
const sticky = (id: string, text: string): BoardElement =>
  ({ id, type: 'sticky', x: ++z * 260, y: 0, w: 200, h: 200, rotation: 0, z, createdBy: 'someone', createdAt: 1, updatedAt: 1, text, color: 'yellow', fontFamily: 'sans', fontSize: 'auto', textColor: '#000', align: 'center', vAlign: 'middle' }) as BoardElement;

/** A team board with AI on for everyone: Ann owns it, Bob (a member) edits it, Cleo (a guest of the workspace) only views it. */
async function board(items: BoardElement[]) {
  const [ann, bob, cleo] = await Promise.all([user('Ann'), user('Bob'), user('Cleo')]);
  const ws = await createTeamWorkspace(ann.id, `Retros ${++n}`);
  await inviteToWorkspace(null, ws.id, ann, { email: bob.email, role: 'member' });
  await inviteToWorkspace(null, ws.id, ann, { email: cleo.email, role: 'guest' });
  const b = await createBoard(ann.id, 'Retro', '', 'none', { workspaceId: ws.id });
  await inviteBoardMember(null, b.id, ann, { email: bob.email, role: 'editor' });
  await inviteBoardMember(null, b.id, ann, { email: cleo.email, role: 'viewer' });
  const doc = new Y.Doc();
  for (const e of items) doc.getMap('elements').set(e.id, e);
  await initBoardDoc(b.id, Y.encodeStateAsUpdate(doc));
  await updateAiSettings(ws.id, ann.id, { enabled: true, source: 'instance', access: 'everyone' });
  return { ann, bob, cleo, ws, boardId: b.id };
}

const rewriteEverything = (rewrite: string[], remove: string[]) =>
  JSON.stringify({
    answer: 'Turned the notes into actions.',
    cites: [...rewrite, ...remove],
    proposal: {
      description: 'Actions',
      create: [{ type: 'card', text: '', title: 'Fix the deploy checklist', color: '', status: 'todo', from: '', to: '' }],
      update: rewrite.map((id) => ({ id, text: 'Rewritten', title: '', color: '', status: '' })),
      delete: remove,
    },
  });

it('running a workflow never writes the board: whatever the model answers becomes one pending group of suggestions from “AI for” the runner — and a viewer can’t run it at all', async () => {
  const { ann, bob, cleo, boardId } = await board([sticky('a', 'Deploys keep failing'), sticky('b', 'Standups run long')]);
  const wf = await createWorkflow(boardId, ann.id, { name: 'Retro to actions', prompt: 'Turn every note into an action card and remove the notes', scope: 'board', shared: true });
  const before = (await readBoardView(boardId, { userId: ann.id, role: 'owner' })).elements.map((e) => JSON.stringify(e.el)).sort();

  replies = [rewriteEverything(['a'], ['b'])];
  const result = await runWorkflow(boardId, wf.id, bob.id, {});

  const after = await readBoardView(boardId, { userId: ann.id, role: 'owner' });
  expect(after.elements.map((e) => JSON.stringify(e.el)).sort()).toEqual(before);
  expect(result.proposal?.count).toBe(after.suggestions.length);
  expect(after.suggestions.length).toBeGreaterThan(0);
  expect(after.suggestions.every((s) => s.author.kind === 'ai' && s.author.userId === bob.id && s.groupId === result.proposal?.groupId && s.description.startsWith('Retro to actions'))).toBe(true);
  expect(new Set(after.suggestions.map((s) => s.op))).toEqual(new Set(['create', 'update', 'delete']));

  // Cleo can see the shared workflow but not run it: refused before anything reaches the model.
  expect((await listWorkflows(boardId, cleo.id)).workflows.map((w) => w.id)).toEqual([wf.id]);
  seen.length = 0;
  await expect(runWorkflow(boardId, wf.id, cleo.id, {})).rejects.toMatchObject({ status: 403, code: 'ai_workflow_edit_only' });
  expect(seen).toHaveLength(0);
});

it('a selection workflow reads what is selected and is refused, before any model call, when nothing it can see is selected', async () => {
  const { ann, boardId } = await board([sticky('a', 'Deploys keep failing'), sticky('b', 'Standups run long')]);
  const wf = await createWorkflow(boardId, ann.id, { name: 'Sharpen', prompt: 'Make these notes more specific', scope: 'selection' });

  await expect(runWorkflow(boardId, wf.id, ann.id, { ids: ['not-on-the-board'] })).rejects.toMatchObject({ status: 400, code: 'ai_workflow_needs_selection' });
  expect(seen).toHaveLength(0);

  replies = [JSON.stringify({ answer: 'Nothing to change.', cites: [], proposal: { description: '', create: [], update: [], delete: [] } })];
  await runWorkflow(boardId, wf.id, ann.id, { ids: ['b'] });
  const sent = seen[0].messages.at(-1)!.content;
  expect(sent).toContain('<selected>');
  expect(sent.slice(sent.indexOf('<selected>'))).toContain('[b]');
  expect(sent.slice(sent.indexOf('<selected>'))).not.toContain('[a]');
});

it('a shared workflow is listed on its workspace’s boards only; its workspace’s admins may unshare it but only its owner may change it', async () => {
  const { ann, bob, boardId } = await board([sticky('a', 'Note')]);
  const wf = await createWorkflow(boardId, bob.id, { name: 'Weekly recap', prompt: 'Summarise this week as three stickies', scope: 'board', shared: true });
  expect((await listWorkflows(boardId, ann.id)).workflows.map((w) => w.id)).toEqual([wf.id]);

  // On a board of another workspace (through a board invite) it isn't there.
  const other = await board([sticky('x', 'Elsewhere')]);
  await inviteBoardMember(null, other.boardId, other.ann, { email: ann.email, role: 'editor' });
  expect((await listWorkflows(other.boardId, ann.id)).workflows).toEqual([]);
  await expect(runWorkflow(other.boardId, wf.id, ann.id, {})).rejects.toMatchObject({ status: 404 });

  // Ann owns the workspace: she may take it out of the workspace, not rewrite it.
  await expect(updateWorkflow(boardId, wf.id, ann.id, { prompt: 'Delete everything' })).rejects.toMatchObject({ status: 403 });
  await updateWorkflow(boardId, wf.id, ann.id, { shared: false });
  expect((await listWorkflows(boardId, ann.id)).workflows).toEqual([]);
  expect((await listWorkflows(boardId, bob.id)).workflows).toMatchObject([{ id: wf.id, mine: true, workspaceId: null, prompt: 'Summarise this week as three stickies' }]);
});

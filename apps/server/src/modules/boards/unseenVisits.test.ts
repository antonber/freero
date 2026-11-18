// Freero's operators looking at a board only its link opens to them leave no trace (visitsUnseen):
// through the real board routes, with real sessions.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { BoardSummary } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { completeSignIn, createUser, getAccount } from '../auth/index';
import { inviteBoardMember } from '../members/index';
import { createBoard, recordBoardOpen, visitsBoardUnseen } from './index';
import boardRoutes from './routes';

let server: http.Server;
let base = '';

beforeAll(async () => {
  const config = await openTestDb({ OPERATOR_EMAILS: 'ops@unseen-visits.test.freero.app' });
  const app = createApp(config);
  app.post('/test/sign-in/:userId', (req, res, next) => void completeSignIn(req, res, req.params.userId, 'password').then((r) => res.json(r), next));
  app.use('/api', boardRoutes({ config, onShutdown: () => undefined } as unknown as ServerContext));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeTestDb();
});

let n = 0;
async function person(label: string, email = `${label.toLowerCase()}-${++n}@unseen-visits.test.freero.app`) {
  const { id } = await createUser({ name: label, email, password: 'password-123' }, { emailVerified: true });
  const res = await fetch(`${base}/test/sign-in/${id}`, { method: 'POST', headers: { origin: base } });
  return { ...(await getAccount(id)), cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
}
const get = async (who: { cookie: string }, path: string) => (await (await fetch(`${base}/api${path}`, { headers: { origin: base, cookie: who.cookie } })).json()) as Record<string, unknown>;
const listed = async (who: { cookie: string }) => ((await get(who, '/boards?filter=all')).boards as BoardSummary[]).map((b) => b.id);

it('an operator opening a board only its link opens to them reads it, read-only, and it never joins their lists (an earlier visit is forgotten); anyone else, or the operator once invited, is an ordinary visitor', async () => {
  const [owner, operator, someone] = [await person('Owner'), await person('Ops', 'ops@unseen-visits.test.freero.app'), await person('Someone')];
  const board = await createBoard(owner.id, 'Public plan', '', 'editor');
  await recordBoardOpen(board.id, operator.id); // a visit from before visits were unseen

  expect(await visitsBoardUnseen(board.id, operator.id)).toBe(true);
  expect(((await get(operator, `/boards/${board.id}`)).board as BoardSummary).role).toBe('viewer');
  expect(await listed(operator)).not.toContain(board.id);

  // Anyone else with the link: what the link gives, and the board joins their lists.
  expect(((await get(someone, `/boards/${board.id}`)).board as BoardSummary).role).toBe('editor');
  expect(await listed(someone)).toContain(board.id);

  // Invited, the operator is a collaborator like any other.
  await inviteBoardMember(null, board.id, owner, { email: operator.email, role: 'editor' });
  expect(await visitsBoardUnseen(board.id, operator.id)).toBe(false);
  expect(((await get(operator, `/boards/${board.id}`)).board as BoardSummary).role).toBe('editor');
  expect(await listed(operator)).toContain(board.id);
});

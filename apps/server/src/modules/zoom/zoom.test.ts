// Freero's Zoom App (#168) over real HTTP: the board a meeting opens for everyone — who may set it,
// and what anyone in (or outside) the meeting can learn from it.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ServerContext } from '../../platform/context';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { completeSignIn, createUser } from '../auth/index';
import { createBoard, setBoardEmbeddable } from '../boards/index';
import zoomRoutes from './routes';

let server: http.Server;
let base = '';

beforeAll(async () => {
  const config = await openTestDb({ PUBLIC_URL: 'https://freero.test', ZOOM_CLIENT_ID: 'zoomClient123' });
  const app = createApp(config);
  app.post('/test/sign-in/:userId', (req, res, next) => void completeSignIn(req, res, req.params.userId, 'password').then((r) => res.json(r), next));
  app.use('/', zoomRoutes({ config, onShutdown: () => undefined } as unknown as ServerContext));
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
async function person(name: string) {
  const { id } = await createUser({ name, email: `${name.toLowerCase()}-${++n}@zoom.test.freero.app`, password: 'password-123' }, { emailVerified: true });
  const res = await fetch(`${base}/test/sign-in/${id}`, { method: 'POST', headers: { origin: base } });
  return { id, cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
}
const setBoard = (meetingUuid: string, boardId: string, cookie?: string) =>
  fetch(`${base}/api/integrations/zoom/meeting-board`, { method: 'PUT', headers: { origin: base, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ meetingUuid, boardId }) });
const lookup = async (meetingUuid: string) =>
  ((await (await fetch(`${base}/api/integrations/zoom/meeting-board/lookup`, { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ meetingUuid }) })).json()) as { boardId: string | null }).boardId;

it('the people a Zoom host invites open the board the host opened for that meeting — set only by someone who can open it while it allows embedding, and found by no other meeting', async () => {
  const host = await person('Hana');
  const stranger = await person('Sam');
  const board = await createBoard(host.id, 'Retro', '');
  const meeting = 'mUuid+Ab12Cd34Ef56==';

  // Not embeddable yet: nobody can put it in a meeting (Zoom shows it only through its embed).
  expect((await setBoard(meeting, board.id, host.cookie)).status).toBe(404);
  await setBoardEmbeddable(board.id, host.id, true);
  expect((await setBoard(meeting, board.id)).status).toBe(401); // signed out
  expect((await setBoard(meeting, board.id, stranger.cookie)).status).toBe(403); // can't open it
  expect(await lookup(meeting)).toBeNull();

  expect((await setBoard(meeting, board.id, host.cookie)).status).toBe(200);
  expect(await lookup(meeting)).toBe(board.id);
  expect(await lookup('mUuid+Other00000000==')).toBeNull();

  // Its owner turning embedding off takes it out of the meeting at once.
  await setBoardEmbeddable(board.id, host.id, false);
  expect(await lookup(meeting)).toBeNull();
});

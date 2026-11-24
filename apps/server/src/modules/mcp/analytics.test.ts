// PostHog MCP analytics (modules/analytics mcpAnalytics.ts) on the real MCP route, a real MCP
// client and a stand-in for PostHog's capture endpoint: what leaves is which tool, how long and
// whether it failed — never what the call carried.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { ApiScope, BoardElement } from '@freero/shared';
import { createContext } from '../../platform/context';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { flushProductEvents, pseudonym, setAccountOptedOut, startProductAnalytics, stopProductAnalytics } from '../analytics/index';
import { createPersonalToken } from '../apiauth/index';
import { createUser } from '../auth/index';
import { createBoard, registerBoardObjectTypes } from '../boards/index';
import { initBoardDoc } from '../realtime/index';
import mcpRoutes, { mountPath } from './routes';

interface Captured {
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
}
const bodies: string[] = [];
const events = (): Captured[] => bodies.flatMap((b) => (JSON.parse(b) as { batch: Captured[] }).batch);

let posthog: http.Server;
let server: http.Server;
let url: URL;
let ctx: ReturnType<typeof createContext>;

beforeAll(async () => {
  posthog = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      bodies.push((req.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":1}');
    });
  });
  await new Promise<void>((r) => posthog.listen(0, '127.0.0.1', r));
  const config = await openTestDb({
    PUBLIC_URL: 'http://freero.test',
    POSTHOG_KEY: 'phc_testtesttesttesttesttest1234',
    POSTHOG_HOST: `http://127.0.0.1:${(posthog.address() as AddressInfo).port}`,
  });
  ctx = createContext(config);
  startProductAnalytics(config);
  const app = createApp(config);
  app.use(mountPath, mcpRoutes(ctx));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
  registerBoardObjectTypes();
});
afterAll(async () => {
  await stopProductAnalytics();
  await ctx.shutdown();
  await new Promise((r) => server.close(r));
  await new Promise((r) => posthog.close(r));
  await closeTestDb();
});

let n = 0;
async function connected(scopes: ApiScope[], { optedOut = false } = {}) {
  const user = await createUser({ name: 'Maria', email: `maria-${++n}@mcp-analytics.test.freero.app`, password: 'password-123' });
  if (optedOut) await setAccountOptedOut(user.id, true);
  const { secret } = await createPersonalToken(user.id, 'password', { name: 'Claude', scopes, expiresInDays: 1 });
  const client = new Client({ name: 'freero-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${secret}` } } }));
  return { user, client };
}
async function boardOf(ownerId: string, text: string): Promise<string> {
  const board = await createBoard(ownerId, 'Acme pricing', '');
  const doc = new Y.Doc();
  doc.getMap('elements').set('s1', { id: 's1', type: 'sticky', x: 0, y: 0, w: 200, h: 200, rotation: 0, z: 1, text, color: 'yellow', createdBy: ownerId } as unknown as BoardElement);
  await initBoardDoc(board.id, Y.encodeStateAsUpdate(doc));
  return board.id;
}

it('a tool call reaches PostHog as $mcp_tool_call under the account’s pseudonym — tool, duration, outcome — and nothing the call carried: no arguments, result, board id or text', async () => {
  const { user, client } = await connected(['boards:read']);
  const boardId = await boardOf(user.id, 'Secret launch price 42');
  // The SDK adds no arguments to Freero's tools.
  const outline = (await client.listTools()).tools.find((t) => t.name === 'get_board_outline')!;
  expect(Object.keys((outline.inputSchema as { properties: object }).properties).sort()).not.toEqual(expect.arrayContaining(['context']));
  for (const injected of ['context', 'conversation_id', 'llm_model']) expect(outline.inputSchema.properties).not.toHaveProperty(injected);

  const read = await client.callTool({ name: 'get_board_outline', arguments: { boardId } });
  expect(JSON.stringify(read)).toContain('Secret launch price 42');
  await flushProductEvents();

  const calls = events().filter((e) => e.event === '$mcp_tool_call' && e.distinct_id === pseudonym('account', user.id));
  expect(calls).toHaveLength(1);
  expect(calls[0].properties).toMatchObject({ $mcp_tool_name: 'get_board_outline', $mcp_is_error: false, $mcp_server_name: 'freero', $geoip_disable: true });
  expect(typeof calls[0].properties.$mcp_duration_ms).toBe('number');
  for (const gone of ['$mcp_parameters', '$mcp_response', '$mcp_intent', '$mcp_error_message', '$mcp_client_user_agent', '$ip']) expect(calls[0].properties).not.toHaveProperty(gone);
  const everything = bodies.join('\n');
  for (const secret of ['Secret launch price', 'Acme', boardId, user.id, user.email]) expect(everything).not.toContain(secret);
});

it('a refused call says in PostHog how it failed — a permission never granted, a wrong id, bad arguments, a delete to confirm — and still nothing of what it carried', async () => {
  const { user, client } = await connected(['boards:read', 'boards:write']);
  const boardId = await boardOf(user.id, 'Failing board text');
  const failing: Array<[tool: string, args: Record<string, unknown>, type: string, status: number | undefined]> = [
    ['add_comment', { boardId, text: 'Hidden comment words' }, 'missing_scope', 403],
    ['get_board_outline', { boardId: 'no-such-board-77' }, 'not_found', 404],
    ['delete_items', { boardId, itemIds: ['s1'] }, 'confirm_required', 400],
    ['add_diagram', { boardId, mermaid: 'flowchart LR', outline: { text: 'Hidden outline words' } }, 'validation', 400],
    // Refused by the SDK before the tool ran: it has no status of Freero's.
    ['add_stickies', { boardId, stickies: [{ words: 'Hidden sticky words' }] }, 'validation', undefined],
  ];
  for (const [name, args] of failing) expect((await client.callTool({ name, arguments: args })).isError, name).toBe(true);
  await flushProductEvents();

  const calls = events().filter((e) => e.event === '$mcp_tool_call' && e.distinct_id === pseudonym('account', user.id));
  expect(calls.map((c) => [c.properties.$mcp_tool_name, c.properties.$mcp_error_type, c.properties.$mcp_error_status])).toEqual(failing.map(([name, , type, status]) => [name, type, status]));
  for (const secret of ['Hidden', 'no-such-board-77', boardId]) expect(bodies.join('\n')).not.toContain(secret);
});

it('an account that turned analytics off sends no MCP events at all', async () => {
  const { user, client } = await connected(['boards:read'], { optedOut: true });
  const boardId = await boardOf(user.id, 'Quiet');
  await client.callTool({ name: 'get_board_outline', arguments: { boardId } });
  await flushProductEvents();
  expect(events().filter((e) => e.event.startsWith('$mcp_') && e.distinct_id === pseudonym('account', user.id))).toEqual([]);
});

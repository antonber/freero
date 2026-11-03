// The public API against its reference (docs/api/openapi.json): what it serves is what the spec
// documents, with the same scopes, and what it answers in a real session has the shapes the spec
// promises — so neither can drift from the other unnoticed.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { initStorage } from '../../platform/storage';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createPersonalToken } from '../apiauth/index';
import type { ApiScope } from '@freero/shared';
import { createUser } from '../auth/index';
import { applyDirectoryMembership, createTeamWorkspace } from '../workspaces/index';
import { attachProblemScreenshot, createProblem } from '../problems/index';
import SPEC from '../../../../../docs/api/openapi.json';
import apiRoutes, { ENDPOINTS, mountPath } from './routes';

type Schema = Record<string, unknown>;
const spec = SPEC as unknown as { paths: Record<string, Record<string, Schema>>; components: Record<string, Record<string, Schema>> };
let server: http.Server;
let base = '';
let full = '';
let readOnly = '';
const OPERATOR = 'operator@api.test.freero.app';

beforeAll(async () => {
  const config = await openTestDb({ PUBLIC_URL: 'http://freero.test', OPERATOR_EMAILS: OPERATOR });
  initStorage(config);
  const app = createApp(config);
  app.use(mountPath, apiRoutes({ config, onShutdown: () => undefined }));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${mountPath}`;
  const me = await createUser({ name: 'Spec', email: 'spec@api.test.freero.app', password: 'password-123' });
  full = (await createPersonalToken(me.id, 'password', { name: 'all', scopes: ['boards:read', 'boards:write', 'boards:suggest', 'comments:write', 'members:read', 'members:write'], expiresInDays: 1 })).secret;
  readOnly = (await createPersonalToken(me.id, 'password', { name: 'read', scopes: ['boards:read'], expiresInDays: 1 })).secret;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeTestDb();
});

const toSpecPath = (p: string) => p.replace(/:(\w+)/g, '{$1}');

it('every endpoint the API serves is in the reference with the same scope, and the reference documents nothing it doesn’t serve', () => {
  const served = new Map(ENDPOINTS.map((e) => [`${e.method} ${toSpecPath(e.path)}`, e.scope]));
  const documented = new Map<string, unknown>();
  for (const [path, ops] of Object.entries(spec.paths))
    for (const [method, op] of Object.entries(ops)) if (method !== 'parameters') documented.set(`${method} ${path}`, op['x-freero-scope']);
  expect([...served.keys()].sort()).toEqual([...documented.keys()].sort());
  for (const [key, scope] of served) expect({ key, scope: documented.get(key) }).toEqual({ key, scope });
  // The OAuth scopes the reference lists are exactly the shared scope model.
  const oauth = spec.components.securitySchemes.oauth as { flows: { authorizationCode: { scopes: Record<string, string> } } };
  expect(Object.keys(oauth.flows.authorizationCode.scopes).sort()).toEqual([...(spec.components.schemas.Scope.enum as string[])].sort());
});

// ---- a small JSON Schema check (the subset the reference uses) ----
function resolve(s: Schema): Schema {
  const ref = s.$ref as string | undefined;
  if (!ref) return s;
  const [, , kind, name] = ref.split('/');
  return resolve(spec.components[kind][name]);
}
function problems(value: unknown, schemaIn: Schema, at = '$'): string[] {
  const s = resolve(schemaIn);
  if (s.oneOf) {
    const fits = (s.oneOf as Schema[]).filter((o) => !problems(value, o, at).length);
    return fits.length === 1 ? [] : [`${at}: matches ${fits.length} of oneOf`];
  }
  if ('const' in s) return value === s.const ? [] : [`${at}: expected ${JSON.stringify(s.const)}`];
  if (s.enum && !(s.enum as unknown[]).includes(value)) return [`${at}: ${JSON.stringify(value)} not in enum`];
  const types = s.type === undefined ? [] : Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
  const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  if (types.length && !types.some((t) => t === typeOf(value) || (t === 'number' && typeOf(value) === 'integer'))) return [`${at}: ${typeOf(value)} is not ${types.join('|')}`];
  const out: string[] = [];
  if (typeOf(value) === 'object') {
    const o = value as Record<string, unknown>;
    for (const k of (s.required as string[] | undefined) ?? []) if (!(k in o)) out.push(`${at}.${k}: missing`);
    for (const [k, sub] of Object.entries((s.properties as Record<string, Schema> | undefined) ?? {})) if (k in o) out.push(...problems(o[k], sub, `${at}.${k}`));
  }
  if (Array.isArray(value) && s.items) value.forEach((v, i) => out.push(...problems(v, s.items as Schema, `${at}[${i}]`)));
  return out;
}

/** Calls the API and checks the answer against the reference's response for that status. */
async function call(method: string, path: string, specPath: string, body?: unknown, token = full) {
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const op = spec.paths[specPath]?.[method.toLowerCase()];
  expect(op, `${method} ${specPath} is documented`).toBeTruthy();
  const response = (op.responses as Record<string, Schema>)[String(res.status)];
  expect(response, `${method} ${specPath} documents status ${res.status}`).toBeTruthy();
  const type = (res.headers.get('content-type') ?? '').split(';')[0];
  const text = await res.text();
  const content = resolve(response).content as Record<string, { schema: Schema }> | undefined;
  if (content) {
    expect(Object.keys(content), `${method} ${specPath} ${res.status} documents ${type}`).toContain(type);
    const json = type === 'application/json' ? JSON.parse(text) : text;
    expect(problems(json, content[type].schema), `${method} ${path} → ${res.status}: ${text.slice(0, 300)}`).toEqual([]);
    return { status: res.status, json };
  }
  return { status: res.status, json: null };
}

it('what the API answers in a real session has the shapes its reference promises', async () => {
  await call('GET', '/me', '/me');
  await call('GET', '/workspaces', '/workspaces');
  const board = (await call('POST', '/boards', '/boards', { title: 'Spec board' })).json.board;
  const B = `/boards/${board.id}`;
  await call('GET', '/boards?q=Spec', '/boards');
  await call('GET', B, '/boards/{boardId}');
  const created = await call('POST', `${B}/items`, '/boards/{boardId}/items', {
    items: [
      { type: 'frame', title: 'Plan', x: 0, y: 0, w: 900, h: 600 },
      { type: 'sticky', text: 'Ship it', x: 100, y: 100, color: 'green' },
      { type: 'card', title: 'Write docs', status: 'doing' },
      { type: 'shape', shape: 'diamond', text: 'Ready?' },
      { type: 'text', text: 'Notes' },
      { type: 'connector', from: '$1', to: '$3', label: 'then' },
    ],
  });
  expect(created.status).toBe(201);
  const [frame, sticky, card, shape] = created.json.items as Array<{ id: string; frameId: string | null }>;
  expect(sticky.frameId).toBe(frame.id); // placed inside the frame under its center
  await call('GET', `${B}/items?type=sticky`, '/boards/{boardId}/items');
  await call('GET', `${B}/items/${sticky.id}`, '/boards/{boardId}/items/{itemId}');
  await call('PATCH', `${B}/items/${sticky.id}`, '/boards/{boardId}/items/{itemId}', { text: 'Shipped', x: 300, y: 200 });
  await call('GET', `${B}/outline`, '/boards/{boardId}/outline');
  await call('GET', `${B}/outline?format=markdown`, '/boards/{boardId}/outline');
  const thread = (await call('POST', `${B}/comments`, '/boards/{boardId}/comments', { text: 'Looks good', itemId: sticky.id })).json.thread;
  await call('POST', `${B}/comments/${thread.id}/replies`, '/boards/{boardId}/comments/{threadId}/replies', { text: 'Thanks' });
  await call('GET', `${B}/comments`, '/boards/{boardId}/comments');
  await call('GET', `${B}/members`, '/boards/{boardId}/members');
  await call('POST', `${B}/structure`, '/boards/{boardId}/structure', { structure: { kind: 'stickies', items: ['a', 'b'] }, target: 'preview' });
  // Suggestions (KAI-169): proposed, listed (also in the outline), stale after an edit, forced, rejected.
  const proposed = await call('POST', `${B}/suggestions`, '/boards/{boardId}/suggestions', {
    description: 'Tidy up',
    create: [{ type: 'sticky', text: 'Idea' }],
    update: [{ id: sticky.id, text: 'Rewritten' }],
  });
  expect(proposed.status).toBe(201);
  await call('GET', `${B}/suggestions`, '/boards/{boardId}/suggestions');
  await call('GET', `${B}/outline?include=suggestions&format=markdown`, '/boards/{boardId}/outline');
  await call('PATCH', `${B}/items/${sticky.id}`, '/boards/{boardId}/items/{itemId}', { text: 'Edited meanwhile' });
  const groupId = proposed.json.group.id as string;
  expect((await call('POST', `${B}/suggestions/accept`, '/boards/{boardId}/suggestions/accept', { groupId })).status).toBe(409);
  await call('POST', `${B}/suggestions/accept`, '/boards/{boardId}/suggestions/accept', { groupId, force: true });
  const second = await call('POST', `${B}/structure`, '/boards/{boardId}/structure', { structure: { kind: 'stickies', items: ['c'] }, target: 'suggestions' });
  await call('POST', `${B}/suggestions/reject`, '/boards/{boardId}/suggestions/reject', { groupId: second.json.groupId });
  // Control room (KAI-172, KAI-249): an agent's lane, as MCP's post_status / get_feedback.
  const lane = await call('POST', `${B}/control-room`, '/boards/{boardId}/control-room', { status: 'Working', tasks: [{ title: 'Ship', state: 'blocked', note: 'Need a review', externalId: 'J-1' }] });
  await call('GET', `${B}/control-room?cursor=${encodeURIComponent(lane.json.cursor)}`, '/boards/{boardId}/control-room');
  expect((await call('DELETE', `${B}/items/${frame.id}`, '/boards/{boardId}/items/{itemId}')).status).toBe(400); // takes its contents along
  await call('DELETE', `${B}/items/${frame.id}?confirm=true`, '/boards/{boardId}/items/{itemId}');
  await call('POST', `${B}/items/delete`, '/boards/{boardId}/items/delete', { ids: [card.id, shape.id], confirm: true });
  expect((await call('POST', `${B}/items`, '/boards/{boardId}/items', { type: 'sticky', text: 'x' }, readOnly)).status).toBe(403);
  expect((await call('DELETE', B, '/boards/{boardId}')).status).toBe(400);
  await call('DELETE', `${B}?confirm=true`, '/boards/{boardId}');
  expect((await call('GET', B, '/boards/{boardId}')).status).toBe(404);

  // Docs (KAI-162): made from Markdown, listed apart from boards, read back, appended to.
  const doc = (await call('POST', '/docs', '/docs', { markdown: '# Decision\n\n- [x] Ship it\n' })).json.doc;
  expect(doc.title).toBe('Decision');
  const D = `/docs/${doc.id}`;
  const listed = await call('GET', '/docs?q=Decision', '/docs');
  expect(listed.json.docs.map((d: { id: string }) => d.id)).toEqual([doc.id]);
  await call('POST', `${D}/append`, '/docs/{docId}/append', { markdown: '| a | b |\n| --- | --- |\n| 1 | 2 |' });
  const read = await call('GET', D, '/docs/{docId}');
  expect(read.json.markdown).toContain('- [x] Ship it');
  expect(read.json.markdown).toContain('| 1 | 2 |');
  await call('GET', `${D}?format=markdown`, '/docs/{docId}');
  // A doc is no board for the board operations (and is not listed among boards).
  expect((await call('GET', `/boards/${doc.id}`, '/boards/{boardId}')).status).toBe(404);
  expect((await call('GET', '/boards?q=Decision', '/boards')).json.boards).toEqual([]);
});

it('the operators’ problem endpoints exist only for an operator’s problems:triage token — anyone else’s token gets 404, the scope is refused to them — and answer in the documented shapes', async () => {
  const reporter = await createUser({ name: 'Reporter', email: 'reporter@api.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const operator = await createUser({ name: 'Operator', email: OPERATOR, password: 'password-123' }, { emailVerified: true });
  const jpeg = new Uint8Array(1024);
  jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
  const diagnostics = { path: '/board/abc', userAgent: 'Test', viewport: { width: 800, height: 600, dpr: 1 }, at: 1, events: [] };
  const { id } = await createProblem(reporter.id, { note: 'The board froze', contactOk: true, diagnostics });
  await attachProblemScreenshot(reporter.id, id, jpeg);
  const P = `/operator/problems/${id}`;

  await expect(createPersonalToken(reporter.id, 'password', { name: 'triage', scopes: ['problems:triage'], expiresInDays: 1 })).rejects.toMatchObject({ status: 403 });
  const reads = [
    ['/operator/problems', '/operator/problems'],
    [P, '/operator/problems/{problemId}'],
    [`${P}/screenshot`, '/operator/problems/{problemId}/screenshot'],
  ] as const;
  for (const [path, specPath] of reads) expect((await call('GET', path, specPath)).status, `${path} with a non-operator's token`).toBe(404);
  expect((await call('PATCH', P, '/operator/problems/{problemId}', { status: 'wontfix' })).status).toBe(404);

  const triage = (await createPersonalToken(operator.id, 'password', { name: 'morning review', scopes: ['problems:triage'], expiresInDays: 1 })).secret;
  const listed = await call('GET', '/operator/problems?status=new', '/operator/problems', undefined, triage);
  expect(listed.json.problems.map((p: { id: string }) => p.id)).toEqual([id]);
  expect((await call('GET', P, '/operator/problems/{problemId}', undefined, triage)).json.problem.reporter.email).toBe('reporter@api.test.freero.app');
  expect((await call('GET', `${P}/screenshot`, '/operator/problems/{problemId}/screenshot', undefined, triage)).status).toBe(200);
  const issueUrl = 'https://github.com/antonber/freero/issues/1';
  const fixed = await call('PATCH', P, '/operator/problems/{problemId}', { status: 'fixed', issueUrl, operatorNote: 'Fixed in the next release' }, triage);
  expect(fixed.json.problem).toMatchObject({ status: 'fixed', issueUrl });
  // The operator's other tokens can't triage.
  const boardsOnly = (await createPersonalToken(operator.id, 'password', { name: 'boards', scopes: ['boards:read'], expiresInDays: 1 })).secret;
  expect((await call('GET', '/operator/problems', '/operator/problems', undefined, boardsOnly)).status).toBe(403);
});

it('a workspace’s audit log over the API pages in order by its cursor, and only for its owners and admins with an audit:read token', async () => {
  const admin = await createUser({ name: 'Audit admin', email: 'audit-admin@api.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const member = await createUser({ name: 'Audit member', email: 'audit-member@api.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const ws = await createTeamWorkspace(admin.id, 'Audited');
  await applyDirectoryMembership(ws.id, member.id, 'member', { overwrite: false });
  const token = async (userId: string, scopes: ApiScope[]) => (await createPersonalToken(userId, 'password', { name: scopes.join(' '), scopes, expiresInDays: 1 })).secret;
  const reader = await token(admin.id, ['audit:read']);
  const A = `/workspaces/${ws.id}/audit`;
  await call('GET', A, '/workspaces/{workspaceId}/audit', undefined, reader); // itself recorded (api.call): two events now
  const first = await call('GET', `${A}?limit=1`, '/workspaces/{workspaceId}/audit', undefined, reader);
  expect(first.json.more).toBe(true);
  const next = await call('GET', `${A}?after=${first.json.cursor}&limit=500`, '/workspaces/{workspaceId}/audit', undefined, reader);
  expect(next.json.events[0].seq).toBe(first.json.events[0].seq + 1);
  expect(next.json.events[0].prevHash).toBe(first.json.events[0].hash);
  // A member with the scope, and an admin without it, get nothing.
  expect((await call('GET', A, '/workspaces/{workspaceId}/audit', undefined, await token(member.id, ['audit:read']))).status).toBe(403);
  expect((await call('GET', A, '/workspaces/{workspaceId}/audit', undefined, await token(admin.id, ['boards:read']))).status).toBe(403);
});

// The public API against its reference (docs/api/openapi.json): what it serves is what the spec
// documents, with the same scopes, and what it answers in a real session has the shapes the spec
// promises — so neither can drift from the other unnoticed.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createPersonalToken } from '../apiauth/index';
import { createUser } from '../auth/index';
import SPEC from '../../../../../docs/api/openapi.json';
import apiRoutes, { ENDPOINTS, mountPath } from './routes';

type Schema = Record<string, unknown>;
const spec = SPEC as unknown as { paths: Record<string, Record<string, Schema>>; components: Record<string, Record<string, Schema>> };
let server: http.Server;
let base = '';
let full = '';
let readOnly = '';

beforeAll(async () => {
  const config = await openTestDb({ PUBLIC_URL: 'http://freero.test' });
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

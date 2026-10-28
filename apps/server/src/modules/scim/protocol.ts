// The SCIM 2.0 HTTP API under /scim/v2 (RFC 7644): bearer-token authentication (the token names the
// workspace), application/scim+json, ListResponse pagination (startIndex / count), filters,
// PATCH, and SCIM error bodies.
import { createHash } from 'node:crypto';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { getConfig } from '../../platform/config';
import { handle, HttpError } from '../../platform/http';
import { logError } from '../../platform/log';
import { consumeRateLimit } from '../../platform/rateLimit';
import { matches, parseFilter, ScimFilterError } from './filter';
import { applyPatch, readPatch } from './patch';
import * as repo from './repo';
import {
  createGroup,
  createUser,
  deleteGroup,
  deleteUser,
  GROUP_SCHEMA,
  groupResource,
  replaceGroup,
  replaceUser,
  ScimError,
  setGroupMembers,
  USER_SCHEMA,
  userResource,
} from './service';

const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const MAX_COUNT = 200;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const workspaces = new WeakMap<Request, string>();
const wsOf = (req: Request) => workspaces.get(req)!;

function send(res: Response, status: number, body: unknown): void {
  res.status(status).type('application/scim+json').send(JSON.stringify(body));
}

/** Bearer token -> its workspace; 401 otherwise. Rate limited per token. */
const authenticate = handle(async (req: Request, _res: Response, next: NextFunction) => {
  const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
  const token = m ? await repo.tokenByHash(sha256(m[1])) : null;
  if (!token) throw new ScimError(401, 'A valid bearer token is required');
  await consumeRateLimit('scim', `token:${token.id}`);
  const now = Date.now();
  if (token.lastUsedAt === null || now - token.lastUsedAt > 60_000) await repo.touchToken(token.id, now);
  workspaces.set(req, token.workspaceId);
  next();
});

function page(req: Request): { start: number; count: number } {
  const start = Math.max(1, Number.parseInt(String(req.query.startIndex ?? '1'), 10) || 1);
  const raw = req.query.count === undefined ? MAX_COUNT : Number.parseInt(String(req.query.count), 10);
  return { start, count: Math.min(MAX_COUNT, Math.max(0, Number.isFinite(raw) ? raw : MAX_COUNT)) };
}

/** A ListResponse page of the resources matching `?filter=` (matched against `full`, answered with `shown`). */
function list(req: Request, res: Response, all: Array<{ full: unknown; shown: unknown }>): void {
  const filter = typeof req.query.filter === 'string' && req.query.filter.trim() ? parseFilter(req.query.filter) : null;
  const hits = (filter ? all.filter((r) => matches(filter, r.full)) : all).map((r) => r.shown);
  const { start, count } = page(req);
  const Resources = hits.slice(start - 1, start - 1 + count);
  send(res, 200, { schemas: [LIST_SCHEMA], totalResults: hits.length, startIndex: start, itemsPerPage: Resources.length, Resources });
}

/** `excludedAttributes=members` (Entra) leaves members out of Groups. */
const withoutMembers = (req: Request) => String(req.query.excludedAttributes ?? '').toLowerCase().split(',').map((s) => s.trim()).includes('members');

async function userResources(workspaceId: string) {
  const [users, groups, members] = await Promise.all([repo.listUsers(workspaceId), repo.listGroups(workspaceId), repo.membersByGroup(workspaceId)]);
  const groupsOf = new Map<string, Array<{ id: string; displayName: string }>>();
  for (const g of groups) for (const u of members.get(g.id) ?? []) groupsOf.set(u, [...(groupsOf.get(u) ?? []), { id: g.id, displayName: g.displayName }]);
  return users.map((u) => userResource(u, groupsOf.get(u.userId) ?? []));
}

async function oneUser(workspaceId: string, userId: string) {
  const u = await repo.getUser(workspaceId, userId);
  if (!u) throw new ScimError(404, 'User not found');
  return userResource(u, (await repo.groupsOfUser(workspaceId, userId)).map((g) => ({ id: g.id, displayName: g.displayName })));
}

async function groupResources(workspaceId: string, { withMembers }: { withMembers: boolean }) {
  const [groups, members, users] = await Promise.all([repo.listGroups(workspaceId), repo.membersByGroup(workspaceId), repo.listUsers(workspaceId)]);
  const display = new Map(users.map((u) => [u.userId, u.displayName ?? u.userName]));
  return groups.map((g) => {
    const full = groupResource(g, (members.get(g.id) ?? []).map((id) => ({ id, display: display.get(id) ?? id })));
    return { full, shown: withMembers ? full : groupResource(g, [], { withMembers: false }) };
  });
}

async function oneGroup(workspaceId: string, groupId: string, withMembers = true) {
  const found = (await groupResources(workspaceId, { withMembers })).find((g) => g.full.id === groupId);
  if (!found) throw new ScimError(404, 'Group not found');
  return found.shown;
}

export function scimRouter(): Router {
  const r = Router();
  r.use(express.json({ type: ['application/scim+json', 'application/json'], limit: getConfig().bodyLimitBytes }));

  // Discovery (no workspace data; still authenticated like everything else).
  r.get('/ServiceProviderConfig', authenticate, (_req, res) =>
    send(res, 200, {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: MAX_COUNT },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [{ type: 'oauthbearertoken', name: 'Bearer token', description: 'A token a workspace admin generates in Freero', primary: true }],
    }),
  );
  r.get('/ResourceTypes', authenticate, (_req, res) =>
    send(res, 200, {
      schemas: [LIST_SCHEMA],
      totalResults: 2,
      Resources: [
        { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'User', name: 'User', endpoint: '/Users', schema: USER_SCHEMA },
        { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'Group', name: 'Group', endpoint: '/Groups', schema: GROUP_SCHEMA },
      ],
    }),
  );
  r.get('/Schemas', authenticate, (_req, res) =>
    send(res, 200, {
      schemas: [LIST_SCHEMA],
      totalResults: 2,
      Resources: [
        { id: USER_SCHEMA, name: 'User', attributes: ['userName', 'externalId', 'name', 'displayName', 'emails', 'active', 'groups'].map((name) => ({ name })) },
        { id: GROUP_SCHEMA, name: 'Group', attributes: ['displayName', 'externalId', 'members'].map((name) => ({ name })) },
      ],
    }),
  );

  // ---- Users ----
  r.get('/Users', authenticate, handle(async (req, res) => list(req, res, (await userResources(wsOf(req))).map((u) => ({ full: u, shown: u })))));
  r.post('/Users', authenticate, handle(async (req, res) => {
    const u = await createUser(wsOf(req), req.body);
    const resource = await oneUser(wsOf(req), u.userId);
    res.setHeader('Location', resource.meta.location);
    send(res, 201, resource);
  }));
  r.get('/Users/:id', authenticate, handle(async (req, res) => send(res, 200, await oneUser(wsOf(req), req.params.id))));
  r.put('/Users/:id', authenticate, handle(async (req, res) => {
    await replaceUser(wsOf(req), req.params.id, req.body);
    send(res, 200, await oneUser(wsOf(req), req.params.id));
  }));
  r.patch('/Users/:id', authenticate, handle(async (req, res) => {
    const current = await oneUser(wsOf(req), req.params.id);
    const patched = applyPatch(current as unknown as Record<string, unknown>, readPatch(req.body));
    await replaceUser(wsOf(req), req.params.id, patched);
    send(res, 200, await oneUser(wsOf(req), req.params.id));
  }));
  r.delete('/Users/:id', authenticate, handle(async (req, res) => {
    await deleteUser(wsOf(req), req.params.id);
    res.status(204).end();
  }));

  // ---- Groups ----
  // Filtered on the full group, so members[value eq …] works with excludedAttributes=members too.
  r.get('/Groups', authenticate, handle(async (req, res) => list(req, res, await groupResources(wsOf(req), { withMembers: !withoutMembers(req) }))));
  r.post('/Groups', authenticate, handle(async (req, res) => {
    const g = await createGroup(wsOf(req), req.body);
    const resource = await oneGroup(wsOf(req), g.id);
    res.setHeader('Location', resource.meta.location);
    send(res, 201, resource);
  }));
  r.get('/Groups/:id', authenticate, handle(async (req, res) => send(res, 200, await oneGroup(wsOf(req), req.params.id, !withoutMembers(req)))));
  r.put('/Groups/:id', authenticate, handle(async (req, res) => {
    await replaceGroup(wsOf(req), req.params.id, req.body, { members: true });
    send(res, 200, await oneGroup(wsOf(req), req.params.id));
  }));
  r.patch('/Groups/:id', authenticate, handle(async (req, res) => {
    const ws = wsOf(req);
    const current = await oneGroup(ws, req.params.id);
    const patched = applyPatch(current as unknown as Record<string, unknown>, readPatch(req.body));
    await replaceGroup(ws, req.params.id, patched, { members: false });
    const members = Array.isArray(patched.members) ? patched.members : [];
    await setGroupMembers(ws, req.params.id, members.map((m) => String((m as { value?: unknown }).value ?? '')).filter(Boolean));
    // Okta and Entra accept 204 or 200 with the group; 200 lets a client read the result.
    send(res, 200, await oneGroup(ws, req.params.id));
  }));
  r.delete('/Groups/:id', authenticate, handle(async (req, res) => {
    await deleteGroup(wsOf(req), req.params.id);
    res.status(204).end();
  }));

  r.use((_req, _res, next) => next(new ScimError(404, 'No such SCIM endpoint')));
  // SCIM error bodies for everything under /scim/v2.
  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ScimFilterError) return send(res, 400, { schemas: [ERROR_SCHEMA], status: '400', scimType: 'invalidFilter', detail: err.message });
    if (err instanceof HttpError) {
      const scimType = err instanceof ScimError ? err.scimType : undefined;
      if (err.status === 429) res.setHeader('Retry-After', String((err as { retryAfter?: number }).retryAfter ?? 60));
      return send(res, err.status, { schemas: [ERROR_SCHEMA], status: String(err.status), ...(scimType ? { scimType } : {}), detail: err.message });
    }
    const e = err as { status?: number; type?: string };
    if (e?.status === 400 || e?.type === 'entity.parse.failed') return send(res, 400, { schemas: [ERROR_SCHEMA], status: '400', scimType: 'invalidSyntax', detail: 'The body is not valid JSON' });
    logError('scim: request failed', err);
    send(res, 500, { schemas: [ERROR_SCHEMA], status: '500', detail: 'Internal server error' });
  });
  return r;
}

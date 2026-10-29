// Credentials for the public API (contract: @freero/shared publicApi.ts):
//   /api/auth/tokens, /api/auth/apps, /api/oauth/clients   managing them (session cookie)
//   /api/oauth/authorize                                     the consent screen's calls (session cookie)
//   /api/oauth/token, /register, /revoke                     OAuth endpoints apps call (no cookie: cross-site)
//   /.well-known/oauth-authorization-server, …/oauth-protected-resource/<path>   metadata
//   /api/workspaces/:id/admin/api                            a team's API policy (owners/admins)
import express, { Router, type Request, type Response } from 'express';
import type { ServerContext } from '../../platform/context';
import { getConfig } from '../../platform/config';
import { badRequest, handle, notFound } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { allowCrossSiteApi } from '../../platform/security';
import { currentSessionMethod, currentUser, requireUser } from '../auth/index';
import { createPersonalToken, listPersonalTokens, revokeEverything, revokePersonalToken, rootResource, setTokenPaused } from './credentials';
import {
  authorizationServerMetadata,
  checkAuthorizeRequest,
  consentInfo,
  decide,
  deleteClient,
  listAuthorizedApps,
  listOwnClients,
  OAuthError,
  protectedResourceMetadata,
  registerClient,
  registerDynamicClient,
  revokeApp,
  revokeRequest,
  tokenRequest,
  type AuthorizeParams,
} from './oauth';
import { setCredentialBlocked, setWorkspaceApiAccess, workspaceApiInfo } from './workspacePolicy';

export const mountPath = '/';

/** The issuer this server answers as (the metadata's `issuer`, RFC 9207 `iss`) and the signed-in person. */
const authorizeContext = (req: Request) => ({ issuer: authorizationServerMetadata(req).issuer, userId: currentUser(req).id });

/** OAuth endpoint errors in the RFC 6749 shape, never cached. */
function oauthEndpoint(fn: (req: Request) => Promise<{ status?: number; body?: unknown }>) {
  return handle(async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!getConfig().publicApi) throw new OAuthError('temporarily_unavailable', 'The Freero API is turned off on this server', 503);
      const out = await fn(req);
      if (out.body === undefined) res.status(out.status ?? 200).end();
      else res.status(out.status ?? 200).json(out.body);
    } catch (e) {
      if (!(e instanceof OAuthError)) throw e;
      res.status(e.status).json({ error: e.error, error_description: e.description });
    }
  });
}

export default function apiAuthRoutes(_ctx: ServerContext): Router {
  const r = Router();
  // Apps call these from anywhere, browsers included; they authenticate with PKCE / client
  // secrets / tokens, never with the session cookie.
  r.use(
    allowCrossSiteApi(/^\/(api\/oauth\/(token|register|revoke)|\.well-known\/oauth-(authorization-server|protected-resource)(\/.*)?)$/, 'OAuth token, registration and revocation endpoints and their metadata authenticate apps by PKCE or client secret, never by cookie', {
      methods: 'GET, POST, OPTIONS',
      headers: 'Authorization, Content-Type',
    }),
  );
  const form = express.urlencoded({ extended: false, limit: '16kb' });

  // ---- metadata (RFC 8414, RFC 9728) ----
  r.get('/.well-known/oauth-authorization-server', (req, res) => res.json(authorizationServerMetadata(req)));
  r.get(/^\/\.well-known\/oauth-protected-resource(\/.*)?$/, (req, res) => {
    const path = (req.params as Record<string, string | undefined>)[0] ?? rootResource();
    const meta = protectedResourceMetadata(req, path);
    if (!meta) return res.status(404).json({ error: 'No such resource' });
    res.json(meta);
  });

  // ---- endpoints apps call ----
  r.post(
    '/api/oauth/register',
    rateLimit('oauthRegister', 'ip'),
    oauthEndpoint(async (req) => ({ status: 201, body: await registerDynamicClient(req.body) })),
  );
  r.post(
    '/api/oauth/token',
    rateLimit('oauthToken', 'ip'),
    form,
    oauthEndpoint(async (req) => ({ body: await tokenRequest(req, (req.body ?? {}) as Record<string, unknown>) })),
  );
  r.post(
    '/api/oauth/revoke',
    rateLimit('oauthToken', 'ip'),
    form,
    oauthEndpoint(async (req) => {
      await revokeRequest(req, (req.body ?? {}) as Record<string, unknown>);
      return {};
    }),
  );

  // ---- the consent screen (a signed-in person, same site) ----
  r.get(
    '/api/oauth/authorize',
    requireUser,
    handle(async (req, res) => {
      const checked = await checkAuthorizeRequest(req.query as AuthorizeParams, authorizeContext(req));
      if ('fatal' in checked) throw badRequest(checked.fatal);
      res.json('redirect' in checked ? { redirect: checked.redirect } : { consent: consentInfo(checked.ok) });
    }),
  );
  r.post(
    '/api/oauth/authorize',
    requireUser,
    handle(async (req, res) => {
      const body = (req.body ?? {}) as AuthorizeParams & { decision?: unknown; grant?: unknown };
      const checked = await checkAuthorizeRequest(body, authorizeContext(req));
      if ('fatal' in checked) throw badRequest(checked.fatal);
      if ('redirect' in checked) return res.json({ redirect: checked.redirect });
      if (body.decision !== 'allow' && body.decision !== 'deny') throw badRequest("decision must be 'allow' or 'deny'");
      res.json({ redirect: await decide(currentUser(req).id, currentSessionMethod(req), checked.ok, body.decision === 'allow', body.grant) });
    }),
  );

  // ---- your tokens, apps and registered apps ----
  r.get(
    '/api/auth/tokens',
    requireUser,
    handle(async (req, res) => res.json({ tokens: await listPersonalTokens(currentUser(req).id) })),
  );
  r.post(
    '/api/auth/tokens',
    requireUser,
    handle(async (req, res) => res.status(201).json(await createPersonalToken(currentUser(req).id, currentSessionMethod(req), req.body))),
  );
  r.patch(
    '/api/auth/tokens/:id',
    requireUser,
    handle(async (req, res) => res.json({ token: await setTokenPaused(currentUser(req).id, req.params.id, req.body?.paused) })),
  );
  r.delete(
    '/api/auth/tokens/:id',
    requireUser,
    handle(async (req, res) => {
      await revokePersonalToken(currentUser(req).id, req.params.id);
      res.json({ ok: true });
    }),
  );
  r.get(
    '/api/auth/apps',
    requireUser,
    handle(async (req, res) => res.json({ apps: await listAuthorizedApps(currentUser(req).id) })),
  );
  r.delete(
    '/api/auth/apps/:clientId',
    requireUser,
    handle(async (req, res) => {
      await revokeApp(currentUser(req).id, req.params.clientId);
      res.json({ ok: true });
    }),
  );
  r.post(
    '/api/auth/api-access/revoke-all',
    requireUser,
    handle(async (req, res) => {
      const me = currentUser(req).id;
      res.json(await revokeEverything(me, me, 'user'));
    }),
  );
  r.get(
    '/api/oauth/clients',
    requireUser,
    handle(async (req, res) => res.json({ clients: await listOwnClients(currentUser(req).id) })),
  );
  r.post(
    '/api/oauth/clients',
    requireUser,
    handle(async (req, res) => res.status(201).json(await registerClient(currentUser(req).id, req.body))),
  );
  r.delete(
    '/api/oauth/clients/:id',
    requireUser,
    handle(async (req, res) => {
      await deleteClient(currentUser(req).id, req.params.id);
      res.json({ ok: true });
    }),
  );

  // ---- a team's API policy (admin console) ----
  r.get(
    '/api/workspaces/:id/admin/api',
    requireUser,
    handle(async (req, res) => res.json(await workspaceApiInfo(req.params.id, currentUser(req).id))),
  );
  r.patch(
    '/api/workspaces/:id/admin/api',
    requireUser,
    handle(async (req, res) => res.json(await setWorkspaceApiAccess(req.params.id, currentUser(req).id, req.body?.enabled))),
  );
  for (const [method, blocked] of [
    ['post', true],
    ['delete', false],
  ] as const)
    r[method](
      '/api/workspaces/:id/admin/api/credentials/:credentialId/block',
      requireUser,
      handle(async (req, res) => {
        if (!req.params.credentialId) throw notFound();
        res.json(await setCredentialBlocked(req.params.id, currentUser(req).id, req.params.credentialId, blocked));
      }),
    );
  return r;
}

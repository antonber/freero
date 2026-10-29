// The remote MCP server (KAI-107): POST /mcp, Streamable HTTP, stateless (JSON responses; no
// session, no server-sent stream), so it works behind round-robin load balancing and nothing
// outlives a revoked credential. Setup and tool reference: docs/mcp.md.
//
// Authorization follows the MCP spec with Freero's own OAuth 2.1 server (modules/apiauth): a
// request without a valid token gets 401 + WWW-Authenticate naming the protected-resource metadata
// (/.well-known/oauth-protected-resource/mcp, also served at the bare well-known path); clients
// register themselves (RFC 7591), the person consents, PKCE S256 is required and tokens are
// bound to this resource (RFC 8707 `resource`). Personal access tokens work as bearer tokens too.
// Read + suggest is the default; changing boards directly is opt-in on the consent screen.
import { Router, type Request, type Response } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { MCP_DEFAULT_SCOPES, MCP_SCOPES, type McpConnectInfo } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { getConfig } from '../../platform/config';
import { logError } from '../../platform/log';
import { appUrl } from '../../platform/mail';
import { consumeRateLimit } from '../../platform/rateLimit';
import { allowCrossSiteApi } from '../../platform/security';
import { authenticate, registerProtectedResource, sendAuthError, type ApiCredential } from '../apiauth/index';
import { requireUser } from '../auth/index';
import { buildServer } from './server';

export const mountPath = '/';

/** The request as the SDK's web-standard handler reads it (the body is already parsed: `parsedBody`). */
function toWebRequest(req: Request): globalThis.Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || name === 'content-length') continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  return new globalThis.Request(`${req.protocol}://${req.get('host') ?? 'localhost'}${req.originalUrl}`, { method: req.method, headers });
}
export const RESOURCE = '/mcp';

/** A JSON-RPC error outside any request (the transport never saw it). */
const rpcError = (res: Response, status: number, message: string) => res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });

export default function mcpRoutes(_ctx: ServerContext): Router {
  registerProtectedResource(RESOURCE, 'Freero MCP server', {
    scopes: MCP_SCOPES,
    optInScopes: MCP_SCOPES.filter((s) => !MCP_DEFAULT_SCOPES.includes(s)),
    root: true,
  });
  const r = Router();
  // AI clients call it from anywhere, browsers included (web-based clients and inspectors).
  r.use(
    allowCrossSiteApi(/^\/mcp$/, 'The MCP endpoint authenticates only with bearer tokens (Authorization header), never with the session cookie', {
      methods: 'GET, POST, DELETE, OPTIONS',
      headers: 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
      expose: 'WWW-Authenticate, Retry-After, Mcp-Session-Id, X-Request-Id',
    }),
  );

  // One handler for both protocol eras (the SDK's per-request serving): 2026-07-28 requests carry
  // their own envelope, 2025-era ones are served by a fresh stateless transport — either way a
  // fresh server per request, built for that request's credential (looked up by its web Request).
  const pending = new WeakMap<globalThis.Request, { req: Request; cred: ApiCredential }>();
  const handler = createMcpHandler(
    (ctx) => {
      const p = ctx.requestInfo ? pending.get(ctx.requestInfo) : undefined;
      if (!p) throw new Error('mcp: a request without its credential');
      return buildServer(p.req, p.cred);
    },
    { legacy: 'stateless', responseMode: 'json', onerror: (e) => logError('mcp: request failed', e) },
  );

  r.post('/mcp', (req: Request, res: Response, next) => {
    void (async () => {
      let cred: ApiCredential;
      try {
        // Every request is authenticated afresh (no cache): a paused or revoked token, a revoked
        // app, a team turning the API off or SSO becoming required stop the very next request.
        cred = await authenticate(req, RESOURCE);
        await consumeRateLimit('apiCredential', `cred:${cred.credentialId}`);
      } catch (e) {
        return sendAuthError(e, res, next);
      }
      try {
        const web = toWebRequest(req);
        pending.set(web, { req, cred });
        const answer = await handler.fetch(web, { parsedBody: req.body });
        res.status(answer.status);
        answer.headers.forEach((value, name) => res.setHeader(name, value));
        if (!answer.body) return res.end();
        Readable.fromWeb(answer.body as unknown as NodeReadableStream).pipe(res);
      } catch (e) {
        logError('mcp: request failed', e);
        if (!res.headersSent) rpcError(res, 500, 'Internal server error');
      }
    })();
  });

  // The app's Connect page (#80): the addresses to put into each client, as this server names them
  // (PUBLIC_URL), so the URL a person pastes is the audience the server binds its tokens to.
  r.get('/api/mcp/connect', requireUser, (req, res) => {
    const info: McpConnectInfo = { mcpUrl: appUrl(req, RESOURCE), apiUrl: appUrl(req, '/api/v1'), enabled: getConfig().publicApi };
    res.json(info);
  });

  // Stateless: no server-sent event stream to open (GET) and no session to end (DELETE).
  r.all('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST, OPTIONS');
    rpcError(res, 405, 'Method not allowed: this server is stateless; send JSON-RPC messages with POST');
  });
  return r;
}

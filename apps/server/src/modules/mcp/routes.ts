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
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MCP_DEFAULT_SCOPES, MCP_SCOPES } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { logError } from '../../platform/log';
import { consumeRateLimit } from '../../platform/rateLimit';
import { allowCrossSiteApi } from '../../platform/security';
import { authenticate, registerProtectedResource, sendAuthError, type ApiCredential } from '../apiauth/index';
import { buildServer } from './server';

export const mountPath = '/';
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
      const server = buildServer(req, cred);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (e) {
        logError('mcp: request failed', e);
        if (!res.headersSent) rpcError(res, 500, 'Internal server error');
      }
    })();
  });

  // Stateless: no server-sent event stream to open (GET) and no session to end (DELETE).
  r.all('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST, OPTIONS');
    rpcError(res, 405, 'Method not allowed: this server is stateless; send JSON-RPC messages with POST');
  });
  return r;
}

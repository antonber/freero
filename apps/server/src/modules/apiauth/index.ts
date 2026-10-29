// Public API of modules/apiauth [S2]: credentials that act for a person without their session —
// personal access tokens and OAuth apps — and each team workspace's API policy. Resource servers
// (modules/api, later the MCP server) authenticate requests here and never touch tokens themselves.
//
//   registerProtectedResource('/api/v1', 'Freero REST API')        once, while building routes
//   const cred = await authenticate(req, '/api/v1')                 401/403 with a WWW-Authenticate challenge
//   requireScope(req, cred, 'boards:write', '/api/v1')               403 insufficient_scope
//   await useInWorkspace(cred, workspaceId)                          the team's switch and blocks
export {
  authenticate,
  requireScope,
  useInWorkspace,
  sendAuthError,
  isBearerError,
  registerProtectedResource,
  createPersonalToken,
  type ApiCredential,
} from './credentials';
// Live board views inside AI assistants (MCP Apps, KAI-171): a single-use ticket per tool call,
// redeemed by the view for a short-lived token that opens one board's socket.
export {
  mintEmbedTicket,
  redeemEmbedTicket,
  authenticateEmbed,
  authenticateEmbedKey,
  embedRoleFor,
  EMBED_SESSION_PREFIX,
  EMBED_TOKEN_MS,
  type EmbedSession,
} from './embed';
// The person's API data for their data export (modules/privacy).
export { apiDataOf } from './dataExport';
// Credentials revoked for good (KAI-224), announced through the outbox in the revoking transaction:
// realtime withdraws the pending suggestions they proposed.
export { CREDENTIAL_REVOKED_TOPIC, type CredentialRevoked } from './repo';

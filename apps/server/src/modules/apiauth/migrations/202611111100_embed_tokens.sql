-- Live board views inside AI assistants (MCP Apps, KAI-171): a tool call mints a single-use TICKET
-- for one board; the view redeems it for a short-lived TOKEN that opens that board's socket. Both
-- act for the person through the credential that made the call: `grant_id` (an app's consent) or
-- `personal_token_id` (a personal token), so disconnecting the app, revoking or deleting the token,
-- or "Disconnect everything" removes them. `max_role` caps the person's own role on the board by
-- what the connection was granted. Secrets are stored as sha256 only.
CREATE TABLE api_embed_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id text NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  max_role text NOT NULL CHECK (max_role IN ('viewer', 'commenter', 'editor')),
  credential_id text NOT NULL,
  label text NOT NULL,
  grant_id text REFERENCES oauth_grants(id) ON DELETE CASCADE,
  personal_token_id text REFERENCES api_tokens(id) ON DELETE CASCADE,
  issued_via text NOT NULL,
  ticket_hash text UNIQUE,
  token_hash text UNIQUE,
  ticket_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (grant_id IS NOT NULL OR personal_token_id IS NOT NULL)
);
CREATE INDEX api_embed_tokens_user ON api_embed_tokens (user_id);
CREATE INDEX api_embed_tokens_board ON api_embed_tokens (board_id);
CREATE INDEX api_embed_tokens_grant ON api_embed_tokens (grant_id);
CREATE INDEX api_embed_tokens_personal ON api_embed_tokens (personal_token_id);
CREATE INDEX api_embed_tokens_expiry ON api_embed_tokens (expires_at);

-- Board pictures drawn on the server (#33): MCP export_board answers a single-use, short-lived
-- download link instead of the picture's bytes for big boards — never the session cookie, never the
-- connection's own token. A ticket acts for the person through the credential that asked for it
-- (`grant_id`: an app's consent, or `personal_token_id`), so disconnecting the app or revoking the
-- token removes it; `spec` is what to draw (format, frame, scale). Stored as sha256 only.
CREATE TABLE api_export_tickets (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id text NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  credential_id text NOT NULL,
  label text NOT NULL,
  grant_id text REFERENCES oauth_grants(id) ON DELETE CASCADE,
  personal_token_id text REFERENCES api_tokens(id) ON DELETE CASCADE,
  issued_via text NOT NULL,
  ticket_hash text NOT NULL UNIQUE,
  spec jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (grant_id IS NOT NULL OR personal_token_id IS NOT NULL)
);
CREATE INDEX api_export_tickets_grant ON api_export_tickets (grant_id);
CREATE INDEX api_export_tickets_personal ON api_export_tickets (personal_token_id);
CREATE INDEX api_export_tickets_expiry ON api_export_tickets (expires_at);

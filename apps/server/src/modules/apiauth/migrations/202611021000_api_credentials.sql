-- Credentials for the public API (KAI-104) and the agent safety controls (KAI-170):
-- personal access tokens, the OAuth 2.0 authorization server (apps, consents, codes, tokens) and
-- each team workspace's API policy. Secrets are stored as sha256 only.

-- Third-party apps. `owner_id` NULL: the app registered itself (dynamic client registration).
-- `secret_hash` NULL: a public client (PKCE only).
CREATE TABLE oauth_clients (
  id text PRIMARY KEY,
  name text NOT NULL,
  website text,
  redirect_uris text NOT NULL,
  owner_id text REFERENCES users(id) ON DELETE CASCADE,
  secret_hash text,
  created_at timestamptz NOT NULL
);
CREATE INDEX oauth_clients_owner ON oauth_clients (owner_id);

-- A person's consent to an app: what it may do, for which resource. Deleting it ends every token
-- the app holds for them.
CREATE TABLE oauth_grants (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes text NOT NULL,
  resource text NOT NULL,
  issued_via text NOT NULL,
  created_at timestamptz NOT NULL,
  last_used_at timestamptz,
  UNIQUE (client_id, user_id)
);
CREATE INDEX oauth_grants_user ON oauth_grants (user_id);

-- Authorization codes: single use (deleted when redeemed), minutes long.
CREATE TABLE oauth_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  scopes text NOT NULL,
  resource text NOT NULL,
  code_challenge text NOT NULL,
  issued_via text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX oauth_codes_expiry ON oauth_codes (expires_at);

-- Bearer credentials: 'personal' (made in settings), 'access' and 'refresh' (an app's, under a
-- grant). `issued_via`: how the session that made it signed in (sign-in restrictions apply to it).
CREATE TABLE api_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('personal', 'access', 'refresh')),
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  hint text NOT NULL,
  scopes text NOT NULL,
  resource text,
  grant_id text REFERENCES oauth_grants(id) ON DELETE CASCADE,
  issued_via text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz,
  last_used_at timestamptz,
  paused_at timestamptz,
  used_at timestamptz
);
CREATE INDEX api_tokens_user ON api_tokens (user_id);
CREATE INDEX api_tokens_grant ON api_tokens (grant_id);
CREATE INDEX api_tokens_expiry ON api_tokens (expires_at);

-- A team workspace's switch for API access (no row: on).
CREATE TABLE api_workspace_settings (
  workspace_id text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by text
);

-- Credentials that reached a team workspace's boards (what its admins see and may block there).
-- `credential_id`: a personal token's id, or '<clientId>:<userId>' for an app (stable when the
-- person re-authorises it, so a block can't be shed that way).
CREATE TABLE api_workspace_credentials (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  credential_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  label text NOT NULL,
  scopes text NOT NULL,
  first_used_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL,
  blocked_at timestamptz,
  blocked_by text,
  PRIMARY KEY (workspace_id, credential_id)
);
CREATE INDEX api_workspace_credentials_user ON api_workspace_credentials (user_id);

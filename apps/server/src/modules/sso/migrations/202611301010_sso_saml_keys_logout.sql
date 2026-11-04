-- #13: the SAML service provider's own key pairs, encrypted assertions, signed requests and single
-- logout.

-- Key pairs of a workspace's SAML service provider (RSA-2048, self-signed certificate). Each is
-- published in the SP metadata (signing + encryption) and decrypts assertions; the `current` one
-- signs AuthnRequests and logout messages. At most two: the current one and the next (rotation).
-- The private key is sealed (platform/secrets, 'sso-sp-key-v1') and never leaves the server.
CREATE TABLE sso_sp_keys (
  id           text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  private_key  text NOT NULL,
  certificate  text NOT NULL,
  current      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL
);
CREATE INDEX sso_sp_keys_workspace_id ON sso_sp_keys (workspace_id);
CREATE UNIQUE INDEX sso_sp_keys_current_key ON sso_sp_keys (workspace_id) WHERE current;

ALTER TABLE sso_connections ADD COLUMN saml_slo_url text;                                  -- the IdP's SingleLogoutService (HTTP-Redirect)
ALTER TABLE sso_connections ADD COLUMN require_encrypted boolean NOT NULL DEFAULT false;   -- refuse assertions that arrive in the clear
ALTER TABLE sso_connections ADD COLUMN sign_requests boolean NOT NULL DEFAULT false;       -- sign AuthnRequests and logout messages

-- Which Freero sessions a SAML sign-in started, so the IdP's LogoutRequest ends exactly those (its
-- NameID, and SessionIndex when it names one) and signing out here can name them to the IdP. Goes
-- with the session (cascade); `session_key` is auth's opaque session key (a hash of the cookie).
CREATE TABLE sso_sessions (
  session_key    text PRIMARY KEY REFERENCES sessions (token_hash) ON DELETE CASCADE,
  workspace_id   text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name_id        text NOT NULL,
  name_id_format text,
  session_index  text,
  created_at     timestamptz NOT NULL
);
CREATE INDEX sso_sessions_workspace_name_id ON sso_sessions (workspace_id, name_id);

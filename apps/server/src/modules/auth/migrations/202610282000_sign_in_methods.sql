-- Owned by modules/auth. "Sign in with …" (OpenID Connect) identities, two-factor authentication
-- (TOTP + recovery codes) and how each session signed in.

-- Accounts created through a sign-in provider have no password until their owner sets one.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- An account at an OpenID Connect provider that signs in to a Freero account.
CREATE TABLE auth_identities (
  id             text PRIMARY KEY,
  user_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider       text NOT NULL,             -- 'google', 'microsoft' (workspace SSO later: its own id)
  issuer         text NOT NULL,             -- the id token's iss (one per tenant for multi-tenant Microsoft)
  subject        text NOT NULL,             -- the id token's sub: the provider's stable account id
  email          text,                      -- as the provider last asserted it (display only)
  email_verified boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL,
  last_used_at   timestamptz NOT NULL,
  CONSTRAINT auth_identities_subject_key UNIQUE (provider, issuer, subject),
  CONSTRAINT auth_identities_user_provider_key UNIQUE (user_id, provider)
);

-- An authorization request in flight (state -> PKCE verifier + nonce). Single use, minutes long.
CREATE TABLE auth_oidc_flows (
  state_hash    text PRIMARY KEY,           -- sha256 of the state; the raw state is in an HttpOnly cookie too
  provider      text NOT NULL,
  intent        text NOT NULL CHECK (intent IN ('login', 'link', 'reauth')),
  user_id       text REFERENCES users (id) ON DELETE CASCADE, -- link / reauth: who started it
  code_verifier text NOT NULL,
  nonce         text NOT NULL,
  return_to     text NOT NULL,
  created_at    timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL
);
CREATE INDEX auth_oidc_flows_expires_at ON auth_oidc_flows (expires_at);
CREATE INDEX auth_oidc_flows_user_id ON auth_oidc_flows (user_id);

-- A sign-in waiting for its second step (the first factor is proven). Single use, minutes long.
CREATE TABLE auth_challenges (
  token_hash text PRIMARY KEY,              -- sha256 of the HttpOnly challenge cookie
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  method     text NOT NULL,                 -- how the first factor was proven ('password', 'email_link', a provider id)
  link       jsonb,                         -- a provider identity to connect once the second step succeeds
  attempts   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_challenges_user_id ON auth_challenges (user_id);
CREATE INDEX auth_challenges_expires_at ON auth_challenges (expires_at);

-- TOTP (authenticator app). enabled_at is null while enrolment awaits its confirmation code.
CREATE TABLE user_totp (
  user_id        text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  secret         text NOT NULL,             -- AES-256-GCM, key derived from SESSION_SECRET
  enabled_at     timestamptz,
  last_time_step bigint,                    -- the last accepted code's time step: a code works once
  created_at     timestamptz NOT NULL
);

-- Single-use recovery codes (sha256; the codes are random, shown once).
CREATE TABLE user_recovery_codes (
  user_id   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at   timestamptz,
  PRIMARY KEY (user_id, code_hash)
);

-- How a session signed in, and when it last proved who it is (passwordless accounts confirm
-- sensitive changes by signing in with their provider again).
ALTER TABLE sessions ADD COLUMN method text NOT NULL DEFAULT 'password';
ALTER TABLE sessions ADD COLUMN two_factor boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN auth_at timestamptz;
UPDATE sessions SET auth_at = created_at;
ALTER TABLE sessions ALTER COLUMN auth_at SET NOT NULL;

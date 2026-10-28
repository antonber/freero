-- Owned by modules/sso. Only modules/sso/repo.ts writes these tables.
--
-- Single sign-on per team workspace: domains it proved it controls (DNS TXT), one identity
-- provider connection (SAML 2.0 or OpenID Connect), the sign-ins in flight, and node-saml's cache
-- of outstanding requests and received assertions (replay protection).

-- A domain a workspace claims. Several workspaces may claim one while unverified; only one can
-- hold it verified (partial unique index), and only a verified domain routes sign-ins or counts as
-- the organization's (JIT accounts, SCIM provisioning, "Enforce SSO").
CREATE TABLE sso_domains (
  id              text PRIMARY KEY,
  workspace_id    text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  domain          text NOT NULL CHECK (domain = lower(domain)),
  token           text NOT NULL,            -- the TXT value to publish (public by design; random per claim)
  verified_at     timestamptz,
  last_checked_at timestamptz,
  created_at      timestamptz NOT NULL,
  CONSTRAINT sso_domains_workspace_domain_key UNIQUE (workspace_id, domain)
);
CREATE UNIQUE INDEX sso_domains_verified_key ON sso_domains (domain) WHERE verified_at IS NOT NULL;
CREATE INDEX sso_domains_domain ON sso_domains (domain);

-- The workspace's identity provider. Secrets: the OIDC client secret is sealed (platform/secrets);
-- SAML certificates are public keys.
CREATE TABLE sso_connections (
  workspace_id        text PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  protocol            text NOT NULL CHECK (protocol IN ('saml', 'oidc')),
  enabled             boolean NOT NULL DEFAULT false,
  -- Password and personal-provider sign-in are refused for addresses at the verified domains,
  -- except for the break-glass owner.
  enforced            boolean NOT NULL DEFAULT false,
  break_glass_user_id text REFERENCES users (id) ON DELETE SET NULL,
  -- Role of people who join through their first SSO sign-in (just-in-time).
  default_role        text NOT NULL DEFAULT 'member' CHECK (default_role IN ('admin', 'member', 'guest')),
  -- Longest session an SSO sign-in gets (SAML SessionNotOnOrAfter shortens it further).
  session_hours       integer NOT NULL DEFAULT 24 CHECK (session_hours BETWEEN 1 AND 720),
  saml_entity_id      text,                 -- the IdP's entityID (Issuer of its assertions)
  saml_sso_url        text,                 -- its SingleSignOnService (HTTP-Redirect binding)
  saml_certs          text,                 -- its signing certificates (PEM, one or more: rollover)
  oidc_issuer         text,
  oidc_client_id      text,
  oidc_client_secret  text,                 -- sealed
  tested_at           timestamptz,          -- the last sign-in that went through (enforcing needs one)
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL
);
CREATE INDEX sso_connections_break_glass_user_id ON sso_connections (break_glass_user_id);

-- A sign-in in flight: bound to the browser that started it (an HttpOnly cookie whose sha256 is
-- browser_hash), single use, 10 minutes. SAML: id is the RelayState and request_id the
-- AuthnRequest ID; the verified claims wait in `result` between the identity provider's
-- cross-site POST and the same-site GET that finishes the sign-in. OIDC: state_hash, nonce, PKCE.
CREATE TABLE sso_flows (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  protocol      text NOT NULL CHECK (protocol IN ('saml', 'oidc')),
  browser_hash  text NOT NULL,
  state_hash    text,
  request_id    text,
  nonce         text,
  code_verifier text,
  return_to     text NOT NULL,
  result        jsonb,
  created_at    timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL
);
CREATE UNIQUE INDEX sso_flows_state_hash_key ON sso_flows (state_hash) WHERE state_hash IS NOT NULL;
CREATE INDEX sso_flows_workspace_id ON sso_flows (workspace_id);
CREATE INDEX sso_flows_expires_at ON sso_flows (expires_at);

-- node-saml's cache provider, per workspace and shared by every instance: outstanding AuthnRequest
-- IDs (a response must answer one, once) and the IDs of assertions already accepted (replay).
CREATE TABLE sso_saml_cache (
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  key          text NOT NULL,
  value        text NOT NULL,
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, key)
);
CREATE INDEX sso_saml_cache_expires_at ON sso_saml_cache (expires_at);

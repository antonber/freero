-- #64 Domain control: what a workspace does with accounts at the domains it VERIFIED (DNS), with or
-- without single sign-on. Only modules/sso/repo.ts writes these tables.

-- Per workspace (it applies to all of its verified domains).
CREATE TABLE sso_domain_policies (
  workspace_id     text PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  -- An account that verifies an address at the domain (sign-up, email change) joins at once.
  capture_signups  boolean NOT NULL DEFAULT false,
  -- People at the domain can't create team workspaces of their own.
  block_workspaces boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL
);

-- Existing accounts an admin is bringing in: the person was emailed and joins at `joins_at` — only
-- if the account still has `email`, verified, and the domain is still the workspace's. A row is
-- removed when they join or the capture is cancelled (the audit log keeps the history).
CREATE TABLE sso_domain_captures (
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email        text NOT NULL,
  joins_at     timestamptz NOT NULL,
  started_by   text REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX sso_domain_captures_joins_at ON sso_domain_captures (joins_at);
CREATE INDEX sso_domain_captures_user_id ON sso_domain_captures (user_id);
CREATE INDEX sso_domain_captures_started_by ON sso_domain_captures (started_by);

-- Owned by modules/scim. Only modules/scim/repo.ts writes these tables.
--
-- SCIM 2.0 provisioning per team workspace: bearer tokens (sha256 only), the people the
-- organization's directory manages here (with the attributes it sent), its groups and their
-- members, and what each group grants in Freero (a workspace role or a project).

CREATE TABLE scim_tokens (
  id           text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  label        text NOT NULL,
  token_hash   text NOT NULL CONSTRAINT scim_tokens_token_hash_key UNIQUE, -- sha256 of the bearer token
  prefix       text NOT NULL,                                               -- first characters, to tell tokens apart
  created_by   text REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL,
  last_used_at timestamptz
);
CREATE INDEX scim_tokens_workspace_id ON scim_tokens (workspace_id);
CREATE INDEX scim_tokens_created_by ON scim_tokens (created_by);

-- A person the directory provisioned into the workspace. Deactivated (active = false): out of the
-- workspace, kept so a reactivation restores them and SSO just-in-time sign-in can't bring them back.
CREATE TABLE scim_users (
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_name    text NOT NULL,
  external_id  text,
  email        text NOT NULL,
  given_name   text,
  family_name  text,
  display_name text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE UNIQUE INDEX scim_users_user_name_key ON scim_users (workspace_id, lower(user_name));
CREATE INDEX scim_users_user_id ON scim_users (user_id);

CREATE TABLE scim_groups (
  id                 text PRIMARY KEY,
  workspace_id       text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  display_name       text NOT NULL,
  external_id        text,
  -- What membership grants in Freero (set by the workspace's admins, not by the directory).
  mapping_kind       text CHECK (mapping_kind IN ('role', 'project')),
  mapping_role       text CHECK (mapping_role IN ('admin', 'member', 'guest')),
  mapping_project_id text REFERENCES projects (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL
);
CREATE UNIQUE INDEX scim_groups_display_name_key ON scim_groups (workspace_id, lower(display_name));
CREATE INDEX scim_groups_mapping_project_id ON scim_groups (mapping_project_id);

CREATE TABLE scim_group_members (
  group_id text NOT NULL REFERENCES scim_groups (id) ON DELETE CASCADE,
  user_id  text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX scim_group_members_user_id ON scim_group_members (user_id);

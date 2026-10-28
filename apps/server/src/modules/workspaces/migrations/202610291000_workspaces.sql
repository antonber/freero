-- Owned by modules/workspaces. Only modules/workspaces/repo.ts writes these tables.
--
-- Every board belongs to a workspace (boards.workspace_id, added by modules/boards right after
-- this). Each user has exactly one PERSONAL workspace (personal_of = the user; deleted with the
-- account); TEAM workspaces are shared, with members in workspace_members.
CREATE TABLE workspaces (
  id               text PRIMARY KEY,
  name             text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('personal', 'team')),
  personal_of      text CONSTRAINT workspaces_personal_of_key UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  -- Sharing policies (team workspaces; a personal workspace keeps the defaults).
  -- Who may give people outside the workspace access to its boards (invites, links).
  external_sharing text NOT NULL DEFAULT 'anyone' CHECK (external_sharing IN ('anyone', 'admins', 'none')),
  -- The highest role a board's "anyone with the link" may grant; 'none' turns links off.
  link_sharing     text NOT NULL DEFAULT 'editor' CHECK (link_sharing IN ('none', 'viewer', 'commenter', 'editor')),
  -- Who may invite guests into the workspace.
  guest_invites    text NOT NULL DEFAULT 'admins' CHECK (guest_invites IN ('admins', 'members')),
  -- Who may export, download or duplicate its boards.
  downloads        text NOT NULL DEFAULT 'anyone' CHECK (downloads IN ('anyone', 'members', 'admins')),
  created_by       text REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL,
  CONSTRAINT workspaces_personal_has_owner CHECK ((kind = 'personal') = (personal_of IS NOT NULL))
);
CREATE INDEX workspaces_created_by ON workspaces (created_by);

-- Workspace roles are separate from board roles: owner/admin manage the workspace, members see
-- every board the workspace shares with them, guests only boards they were invited to.
CREATE TABLE workspace_members (
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  created_at   timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_id ON workspace_members (user_id);

-- Pending invites for addresses without an account (same mechanics as board_invites: the emailed
-- link carries a random token, only its sha256 is stored, single use).
CREATE TABLE workspace_invites (
  id           text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  email        text NOT NULL CHECK (email = lower(email)),
  role         text NOT NULL CHECK (role IN ('admin', 'member', 'guest')),
  token_hash   text NOT NULL CONSTRAINT workspace_invites_token_hash_key UNIQUE,
  invited_by   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL,
  CONSTRAINT workspace_invites_workspace_email_key UNIQUE (workspace_id, email)
);
CREATE INDEX workspace_invites_email ON workspace_invites (email);
CREATE INDEX workspace_invites_invited_by ON workspace_invites (invited_by);

-- Projects (folders) group a workspace's boards. 'workspace': every member sees its boards;
-- 'private': only its members (project_members) and the workspace's owners/admins.
CREATE TABLE projects (
  id           text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  access       text NOT NULL DEFAULT 'workspace' CHECK (access IN ('workspace', 'private')),
  created_by   text REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL
);
CREATE INDEX projects_workspace_id ON projects (workspace_id);
CREATE INDEX projects_created_by ON projects (created_by);

CREATE TABLE project_members (
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX project_members_user_id ON project_members (user_id);

-- Backfill: every existing user gets their personal workspace (new users get one on first use).
INSERT INTO workspaces (id, name, kind, personal_of, created_by, created_at, updated_at)
  SELECT 'p' || substr(md5(id), 1, 15), 'Personal', 'personal', id, id, created_at, created_at FROM users;
INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
  SELECT id, personal_of, 'owner', created_at FROM workspaces WHERE kind = 'personal';

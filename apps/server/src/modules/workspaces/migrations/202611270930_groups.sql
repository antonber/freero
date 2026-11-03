-- Owned by modules/workspaces. #63: user groups made in Freero ("Design", "Contractors"). A group
-- belongs to one workspace and holds members of that workspace; boards (members' board_group_grants)
-- and projects (project_groups) can be shared with it, and access follows its membership live.
CREATE TABLE workspace_groups (
  id           text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  created_by   text,
  created_at   timestamptz NOT NULL
);
CREATE UNIQUE INDEX workspace_groups_name ON workspace_groups (workspace_id, lower(name));

CREATE TABLE workspace_group_members (
  group_id text NOT NULL REFERENCES workspace_groups (id) ON DELETE CASCADE,
  user_id  text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX workspace_group_members_user ON workspace_group_members (user_id);

-- A project shared with a group: its members are in the project as long as they are in the group.
CREATE TABLE project_groups (
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  group_id   text NOT NULL REFERENCES workspace_groups (id) ON DELETE CASCADE,
  added_at   timestamptz NOT NULL,
  PRIMARY KEY (project_id, group_id)
);
CREATE INDEX project_groups_group ON project_groups (group_id);

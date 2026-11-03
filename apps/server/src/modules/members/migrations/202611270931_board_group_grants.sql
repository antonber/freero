-- Owned by modules/members. #63: a board shared with a group of its workspace, at a role. Members of
-- the group get at least that role (resolveRole takes the highest of their direct membership and
-- their groups' grants); a grant counts only while the group is of the board's own workspace.
CREATE TABLE board_group_grants (
  board_id   text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  group_id   text NOT NULL REFERENCES workspace_groups (id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')),
  granted_by text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (board_id, group_id)
);
CREATE INDEX board_group_grants_group ON board_group_grants (group_id);

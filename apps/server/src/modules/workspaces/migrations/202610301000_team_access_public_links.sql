-- Owned by modules/workspaces.
-- Team access level: what a team workspace's members get on its boards (owners/admins always
-- edit). A project may set its own level for its boards (NULL: the workspace's).
ALTER TABLE workspaces ADD COLUMN team_access text NOT NULL DEFAULT 'editor'
  CHECK (team_access IN ('editor', 'commenter', 'viewer'));
ALTER TABLE projects ADD COLUMN team_access text
  CHECK (team_access IN ('editor', 'commenter', 'viewer'));
-- Who a board's "anyone with the link" lets in: also visitors without an account (named guests,
-- capped at commenter, one board) or signed-in people only.
ALTER TABLE workspaces ADD COLUMN public_links text NOT NULL DEFAULT 'anyone'
  CHECK (public_links IN ('anyone', 'signed_in'));

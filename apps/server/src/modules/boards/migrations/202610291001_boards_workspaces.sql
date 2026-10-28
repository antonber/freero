-- Owned by modules/boards. Every board belongs to a workspace (modules/workspaces) and optionally
-- to one of its projects. Existing boards move into their owner's personal workspace.
-- Deleting a workspace deletes its boards first (modules/workspaces asks modules/boards).
ALTER TABLE boards ADD COLUMN workspace_id text REFERENCES workspaces (id);
-- A project is deleted only while it holds no live board (checked under the project's row lock);
-- boards still in the trash fall back to the workspace root.
ALTER TABLE boards ADD COLUMN project_id text REFERENCES projects (id) ON DELETE SET NULL;
UPDATE boards b SET workspace_id = w.id FROM workspaces w WHERE w.personal_of = b.owner_id;
ALTER TABLE boards ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX boards_workspace_id ON boards (workspace_id);
CREATE INDEX boards_project_id ON boards (project_id) WHERE project_id IS NOT NULL;

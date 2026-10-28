-- Owned by modules/templates. A template may be shared with one team workspace: its members (not
-- guests) can then list and insert it. NULL = personal (its owner only).
ALTER TABLE templates ADD COLUMN workspace_id text REFERENCES workspaces (id) ON DELETE SET NULL;
CREATE INDEX templates_workspace_id ON templates (workspace_id) WHERE workspace_id IS NOT NULL;

-- Owned by modules/workspaces. #155: who may share templates with the workspace (on an
-- organisation's row: who may publish to the organisation, and a floor for its workspaces).
ALTER TABLE workspaces ADD COLUMN template_publishing text NOT NULL DEFAULT 'members'
  CHECK (template_publishing IN ('members', 'admins'));

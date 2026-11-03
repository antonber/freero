-- Owned by modules/scim. #108: an organisation's directory group can grant membership of one of
-- its team workspaces with a role ({ kind: 'workspace', workspaceId, role }); mapping_role holds
-- the role. A workspace that is deleted drops the mapping (the group then grants nothing).
ALTER TABLE scim_groups DROP CONSTRAINT scim_groups_mapping_kind_check;
ALTER TABLE scim_groups ADD CONSTRAINT scim_groups_mapping_kind_check CHECK (mapping_kind IN ('role', 'project', 'workspace'));
ALTER TABLE scim_groups ADD COLUMN mapping_workspace_id text REFERENCES workspaces (id) ON DELETE SET NULL;
CREATE INDEX scim_groups_mapping_workspace_id ON scim_groups (mapping_workspace_id);

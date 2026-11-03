-- Owned by modules/workspaces. #151: admin roles — what an admin administers (members, content,
-- security). NULL: all three (every admin from before #151 keeps meaning "everything"). Only read
-- for role 'admin' (owners have all three); a role change away from admin clears it (repo.setRole).
ALTER TABLE workspace_members ADD COLUMN admin_scopes text[];
ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_admin_scopes
  CHECK (admin_scopes IS NULL OR (cardinality(admin_scopes) > 0 AND admin_scopes <@ ARRAY['members', 'content', 'security']::text[]));

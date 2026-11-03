-- Owned by modules/workspaces. #108: organisations above team workspaces (docs/design/organisations.md).
--
-- An organisation is a directory-only row of `workspaces` (kind 'organisation'): its members are
-- the organisation's owners, admins and directory, its policy and security columns are FLOORS for
-- the team workspaces attached to it, and the identity tables keyed by a workspace id (sso_*,
-- scim_*, siem_sinks, the audit chain) serve it unchanged. It never holds boards or projects.
ALTER TABLE workspaces DROP CONSTRAINT workspaces_kind_check;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_kind_check CHECK (kind IN ('personal', 'team', 'organisation'));

-- The organisation a TEAM workspace belongs to (at most one: a column), and since when.
-- No ON DELETE action: an organisation is deleted only once nothing is attached to it.
ALTER TABLE workspaces ADD COLUMN organisation_id text REFERENCES workspaces (id);
ALTER TABLE workspaces ADD COLUMN organisation_attached_at timestamptz;
ALTER TABLE workspaces ADD CONSTRAINT workspaces_organisation_of_team
  CHECK (organisation_id IS NULL OR kind = 'team');
ALTER TABLE workspaces ADD CONSTRAINT workspaces_organisation_attached_at
  CHECK ((organisation_id IS NULL) = (organisation_attached_at IS NULL));
CREATE INDEX workspaces_organisation_id ON workspaces (organisation_id) WHERE organisation_id IS NOT NULL;

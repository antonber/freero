-- Owned by modules/privacy. Only modules/privacy/repo.ts writes this table.
--
-- Data exports (GDPR access / portability): a person's own data, or a team workspace's (its
-- owners/admins). Built by a background job into a ZIP in object storage (uploads' private files),
-- then downloadable by the person who asked, until expires_at. When the person or the workspace
-- goes away the reference becomes NULL and the job deletes the file and the row.
CREATE TABLE data_exports (
  id           text PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('user', 'workspace')),
  requested_by text REFERENCES users (id) ON DELETE SET NULL,
  workspace_id text REFERENCES workspaces (id) ON DELETE SET NULL,
  status       text NOT NULL CHECK (status IN ('pending', 'running', 'ready', 'failed', 'expired')),
  attempts     integer NOT NULL DEFAULT 0,
  file_key     text,
  bytes        bigint,
  error        text,
  created_at   timestamptz NOT NULL,
  started_at   timestamptz,
  ready_at     timestamptz,
  expires_at   timestamptz
);
CREATE INDEX data_exports_requested_by ON data_exports (requested_by);
CREATE INDEX data_exports_workspace_id ON data_exports (workspace_id);
CREATE INDEX data_exports_status ON data_exports (status, created_at);

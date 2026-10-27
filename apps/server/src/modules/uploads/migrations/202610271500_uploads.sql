-- Owned by modules/uploads. Only modules/uploads/repo.ts writes this table.
-- One row per file a user uploaded (for per-user storage quotas). Board thumbnails and files
-- uploaded before this table existed have no row and do not count towards any quota.
CREATE TABLE uploads (
  name         text PRIMARY KEY,           -- storage key "<id>.<ext>", served at /uploads/<name>
  owner_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  bytes        bigint NOT NULL CHECK (bytes >= 0),
  content_type text NOT NULL,
  created_at   timestamptz NOT NULL
);
CREATE INDEX uploads_owner_id ON uploads (owner_id);

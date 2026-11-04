-- Owned by modules/stickers. Only modules/stickers/repo.ts writes these tables.
-- A workspace's own sticker sets (#138): named sets of images its members place on boards. The
-- images are uploads (modules/uploads); a set removed leaves the stickers already placed on boards
-- alone (they hold the upload URL), and files nothing references are left to the uploads sweep.
CREATE TABLE sticker_sets (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name          text NOT NULL,
  created_by    text REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL
);
CREATE INDEX sticker_sets_workspace_id ON sticker_sets (workspace_id);

CREATE TABLE stickers (
  id            text PRIMARY KEY,
  set_id        text NOT NULL REFERENCES sticker_sets (id) ON DELETE CASCADE,
  name          text NOT NULL,
  upload_name   text NOT NULL,           -- the file at /uploads/<upload_name>
  created_by    text REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL
);
CREATE INDEX stickers_set_id ON stickers (set_id, created_at);
CREATE INDEX stickers_upload_name ON stickers (upload_name);

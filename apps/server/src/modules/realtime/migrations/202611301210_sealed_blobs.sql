-- Owned by modules/realtime. Only modules/realtime/repo.ts writes these tables.
--
-- #159 (docs/design/compliance.md §3): board content of a workspace with an encryption key is
-- stored sealed (AES-256-GCM under the workspace's data key, modules/keys). `sealed_with` names the
-- data key a row was sealed with ('<workspaceId>:<version>'); NULL: stored as is (every row before
-- this, and boards of workspaces without a key). A sealed row is only ever opened with the key it
-- names, and its additional data binds it to its board, table and layer.
ALTER TABLE board_docs ADD COLUMN sealed_with text;
ALTER TABLE board_doc_updates ADD COLUMN sealed_with text;
ALTER TABLE board_doc_snapshots ADD COLUMN sealed_with text;
ALTER TABLE board_layers ADD COLUMN sealed_with text;
ALTER TABLE board_layer_updates ADD COLUMN sealed_with text;

-- The upload names sealed rows of a board reference (file names only, no content), written with
-- every sealed row: what the uploads sweep and usage read instead of the sealed bytes, so a file of
-- an encrypted board — or of one whose key can't be used right now — is never swept. Grows with the
-- board and goes with it.
CREATE TABLE board_sealed_refs (
  board_id text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  name     text NOT NULL,
  PRIMARY KEY (board_id, name)
);
CREATE INDEX board_sealed_refs_name ON board_sealed_refs (name);

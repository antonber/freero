-- Owned by modules/uploads. #159 (docs/design/compliance.md §3): files under a workspace's key.
--   workspace_id  the workspace whose key governs the file: the workspace of the board it was
--                 uploaded to (NULL for files uploaded without a board, and those from before this
--                 column). A move of the board it belongs to hands it to the target workspace.
--   sealed_with   '<workspaceId>:<dataKeyVersion>' when the stored bytes are sealed (the object then
--                 starts with a header naming that data key, and is served only through the server,
--                 opened while that key is usable); NULL when stored as uploaded.
-- A sealed file's row outlives its owner's account (the purge detaches it, like a removed file's):
-- without it the sweep's adoption would give the name a row that doesn't say it is sealed.
ALTER TABLE uploads ADD COLUMN workspace_id text;
ALTER TABLE uploads ADD COLUMN sealed_with text;
CREATE INDEX uploads_workspace_id ON uploads (workspace_id) WHERE workspace_id IS NOT NULL;

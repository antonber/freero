-- Owned by modules/boards. #153: who moved a board to the trash (the admin console's workspace trash;
-- no foreign key: the log of who did it outlives the account, read as "Deleted user"), and boards
-- archived — kept, read-only for everyone, out of the default dashboard views — until unarchived.
ALTER TABLE boards ADD COLUMN deleted_by text;
ALTER TABLE boards ADD COLUMN archived_at timestamptz;
ALTER TABLE boards ADD COLUMN archived_by text;
CREATE INDEX boards_archived ON boards (workspace_id) WHERE archived_at IS NOT NULL;
CREATE INDEX boards_trashed_in_workspace ON boards (workspace_id, deleted_at) WHERE deleted_at IS NOT NULL;

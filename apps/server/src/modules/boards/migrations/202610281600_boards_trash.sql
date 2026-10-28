-- Owned by modules/boards. Trash: deleting a board sets deleted_at instead of removing the row;
-- the board is gone for everyone (lists, access, sockets) until its owner restores it, and is
-- removed for good (with its members, stars, opens and doc, by ON DELETE CASCADE) once it has
-- been in the trash longer than the retention period.
ALTER TABLE boards ADD COLUMN deleted_at timestamptz;
-- The purge job finds trashed boards by age.
CREATE INDEX boards_deleted_at ON boards (deleted_at) WHERE deleted_at IS NOT NULL;

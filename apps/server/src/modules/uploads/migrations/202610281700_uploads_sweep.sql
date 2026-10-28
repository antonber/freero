-- Owned by modules/uploads. Mark-and-sweep of uploads nothing references any more (sweep.ts).
--
-- last_referenced_at: the last sweep round that found the file referenced (a board document, a
-- saved template, an avatar…). A file is deleted only once no round has seen it referenced for
-- the grace period (counted from created_at for a file never seen referenced, so uploads still
-- on their way onto a board are kept).
ALTER TABLE uploads ADD COLUMN last_referenced_at timestamptz;

-- Deleting an account no longer deletes the rows of its uploads: images it placed on boards other
-- people keep must keep working, and the sweep removes the rest once nothing references them.
ALTER TABLE uploads ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE uploads DROP CONSTRAINT uploads_owner_id_fkey;
ALTER TABLE uploads ADD CONSTRAINT uploads_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE SET NULL;

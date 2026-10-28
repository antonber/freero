-- Owned by modules/uploads. Mark-and-sweep of uploads nothing references any more (sweep.ts).
--
-- last_referenced_at: the last sweep round that found the file referenced (a board document, a
-- saved template, an avatar, a thumbnail…). A file is deleted only once no round has seen it
-- referenced for the grace period (counted from created_at for a file never seen referenced, so
-- uploads still on their way onto a board are kept).
--
-- Rows without an owner: stored files that had no row (board and template thumbnails, files from
-- before this table, rows deleted with their owner's account) are adopted by the sweep with
-- owner_id NULL and created_at = when it first saw them. They count toward nobody's quota.
ALTER TABLE uploads ADD COLUMN last_referenced_at timestamptz;
ALTER TABLE uploads ALTER COLUMN owner_id DROP NOT NULL;

-- Owned by modules/realtime. Only modules/realtime/repo.ts writes this table.
--
-- Version history (KAI-49) on top of the snapshots compaction keeps:
--   kind 'auto'            taken by compaction; thinned out by age (retention.ts, KAI-72)
--   kind 'named'           an editor named it; never pruned
--   kind 'before-restore'  the board just before a restore (restoring it undoes the restore);
--                          thinned like 'auto'
ALTER TABLE board_doc_snapshots ADD COLUMN kind text NOT NULL DEFAULT 'auto'
  CHECK (kind IN ('auto', 'named', 'before-restore'));
ALTER TABLE board_doc_snapshots ADD COLUMN name text;
ALTER TABLE board_doc_snapshots ADD COLUMN created_by text REFERENCES users (id) ON DELETE SET NULL;
CREATE INDEX board_doc_snapshots_created_by ON board_doc_snapshots (created_by) WHERE created_by IS NOT NULL;

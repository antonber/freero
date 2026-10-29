-- Owned by modules/realtime. Only modules/realtime/repo.ts writes this table.
--
-- Decision snapshots (KAI-161): a version of kind 'decision' is the frozen content of a decision
-- (modules/decisions points at it). Like a named version it is never pruned; deleting the
-- decision turns it into an ordinary named version.
ALTER TABLE board_doc_snapshots DROP CONSTRAINT board_doc_snapshots_kind_check;
ALTER TABLE board_doc_snapshots ADD CONSTRAINT board_doc_snapshots_kind_check
  CHECK (kind IN ('auto', 'named', 'before-restore', 'decision'));

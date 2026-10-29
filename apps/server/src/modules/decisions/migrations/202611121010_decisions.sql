-- Owned by modules/decisions. Only modules/decisions/repo.ts writes this table.
--
-- Decision snapshots (KAI-161): a board, or one frame of it, frozen under a name. The content is
-- the board version `version_id` (modules/realtime, kind 'decision': never pruned, never written
-- again); a frame decision shows only `frame_id`'s part of it.
CREATE TABLE decisions (
  id          text PRIMARY KEY,
  board_id    text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  version_id  bigint NOT NULL REFERENCES board_doc_snapshots (id) ON DELETE CASCADE,
  title       text NOT NULL,
  note        text NOT NULL DEFAULT '',
  frame_id    text,
  frame_title text,
  created_by  text REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL
);
CREATE INDEX decisions_board ON decisions (board_id, created_at DESC);
CREATE INDEX decisions_created_by ON decisions (created_by) WHERE created_by IS NOT NULL;

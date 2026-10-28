-- The references index (KAI-149): which board content points at which object — item links,
-- object addresses written in text and comments, smart links / embeds. DERIVED from each board's
-- saved shared doc by the `references` outbox consumer (platform/outbox.ts): rows are replaced
-- per source board, never patched, and are hints only — every read re-checks the reader's live
-- access to each source (modules/objects).

-- One row per source board that was derived: the version of the newest derivation, so an older
-- one (a slower run, a rebuild racing a live batch) never replaces newer rows.
CREATE TABLE reference_sources (
  board_id   text PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  version    bigint NOT NULL,
  derived_at timestamptz NOT NULL
);

CREATE TABLE object_references (
  board_id       text NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  -- The item on the source board that holds the reference ('' when it is not on an item: a
  -- comment thread pinned to the canvas).
  source_element text NOT NULL DEFAULT '',
  -- That item's element type ('sticky', 'frame', …), for "Linked from" labels.
  source_type    text,
  -- The canonical address of the target (freero://…).
  target         text NOT NULL,
  -- The board the target is or lives on, for "what links to this board or anything on it".
  target_board   text,
  kind           text NOT NULL,
  version        bigint NOT NULL,
  PRIMARY KEY (board_id, source_element, target, kind)
);
CREATE INDEX object_references_target ON object_references (target);
CREATE INDEX object_references_target_board ON object_references (target_board) WHERE target_board IS NOT NULL;

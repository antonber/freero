-- Owned by modules/realtime. Only modules/realtime/repo.ts writes these tables.
-- Server-held layer docs of a board (see "Board layers" in ARCHITECTURE.md): content the server
-- withholds from some connections. layer = 'editors' or 'u:<userId>' (that user's private layer).
-- Stored like the board doc itself: a compacted base (board_layers) plus an append-only log of the
-- updates saved since (board_layer_updates), so several instances can save without overwriting
-- each other; `version` is the compaction's optimistic lock. A layer that compacts to nothing (or
-- whose owner lost access to the board) is deleted.
CREATE TABLE board_layers (
  board_id   text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  layer      text NOT NULL,
  state      bytea NOT NULL,               -- Y.encodeStateAsUpdate(layer doc)
  version    bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (board_id, layer)
);

CREATE TABLE board_layer_updates (
  id         bigserial PRIMARY KEY,
  board_id   text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  layer      text NOT NULL,
  data       bytea NOT NULL,               -- one Yjs update (several merged, per save)
  created_at timestamptz NOT NULL
);
CREATE INDEX board_layer_updates_board ON board_layer_updates (board_id, layer, id);

-- Owned by modules/realtime. Only modules/realtime/repo.ts writes this table.
-- Server-held layer docs of a board (see "Board layers" in ARCHITECTURE.md): content the server
-- withholds from some connections. layer = 'editors' or 'u:<userId>' (that user's private layer).
CREATE TABLE board_layers (
  board_id   text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  layer      text NOT NULL,
  state      bytea NOT NULL,               -- Y.encodeStateAsUpdate(layer doc)
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (board_id, layer)
);

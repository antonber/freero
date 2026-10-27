-- Owned by modules/realtime. Only modules/realtime/repo.ts writes this table.
CREATE TABLE IF NOT EXISTS board_docs (
  board_id   TEXT PRIMARY KEY,
  state      BLOB NOT NULL,                -- Y.encodeStateAsUpdate(doc)
  updated_at INTEGER NOT NULL
);

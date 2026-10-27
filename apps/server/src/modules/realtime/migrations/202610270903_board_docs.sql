-- Owned by modules/realtime. Only modules/realtime/repo.ts writes this table.
CREATE TABLE board_docs (
  board_id   text PRIMARY KEY REFERENCES boards (id) ON DELETE CASCADE,
  state      bytea NOT NULL,               -- Y.encodeStateAsUpdate(doc)
  updated_at timestamptz NOT NULL
);

-- Owned by modules/realtime. Only modules/realtime/repo.ts writes these tables.
--
-- A board's document is stored as a compacted base (board_docs.state) plus an append-only log of
-- the Yjs updates saved since (board_doc_updates). Loading applies the base, then every log row.
-- Compaction folds the rows it read into a new base and deletes exactly those rows; `version`
-- is its optimistic lock (two compactions of one board never overwrite each other's base).
ALTER TABLE board_docs ADD COLUMN version bigint NOT NULL DEFAULT 0;

CREATE TABLE board_doc_updates (
  id         bigserial PRIMARY KEY,
  board_id   text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  data       bytea NOT NULL,             -- one Yjs update (several merged, per save)
  created_at timestamptz NOT NULL
);
CREATE INDEX board_doc_updates_board ON board_doc_updates (board_id, id);

-- Full document states kept by compaction at most every so often: the base of version history.
CREATE TABLE board_doc_snapshots (
  id         bigserial PRIMARY KEY,
  board_id   text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  state      bytea NOT NULL,             -- Y.encodeStateAsUpdate(doc)
  created_at timestamptz NOT NULL
);
CREATE INDEX board_doc_snapshots_board ON board_doc_snapshots (board_id, created_at);

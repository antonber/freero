-- The search index (KAI-151, KAI-141): what each board SAYS — its title, its items' text, frame
-- titles, table cells, tags, connector labels and comments — DERIVED from the board's saved shared
-- content (what every reader of the board sees: no private drafts, nothing under a hidden frame) by
-- the `search` outbox consumer. Rows are replaced per board, never patched, and are hints only:
-- every query re-checks the reader's live access to each board (modules/objects).
--
-- Postgres full-text search with the `simple` configuration (no stemming, no stop words: it works
-- the same for every language, and on PGlite). A later slice adds an `embedding` column (pgvector)
-- filled only when an AI provider is configured.

-- One row per derived board: the version of the newest derivation, so an older one (a slower run,
-- a rebuild racing a live batch) never replaces newer rows.
CREATE TABLE search_sources (
  board_id   text PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  version    bigint NOT NULL,
  derived_at timestamptz NOT NULL
);

CREATE TABLE search_entries (
  board_id     text NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  -- '' for the board itself, the element id for an item, 'c:<thread>:<message>' for a comment.
  entry_key    text NOT NULL,
  kind         text NOT NULL,
  -- The item it is on (items, comments pinned to an item) and that item's element type.
  element_id   text,
  element_type text,
  thread_id    text,
  body         text NOT NULL,
  tsv          tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED,
  version      bigint NOT NULL,
  PRIMARY KEY (board_id, entry_key)
);
CREATE INDEX search_entries_tsv ON search_entries USING gin (tsv);

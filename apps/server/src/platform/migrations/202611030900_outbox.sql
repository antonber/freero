-- The transactional outbox (platform/outbox.ts, KAI-148). A module appends an event in the SAME
-- transaction as the change it describes, so an event exists exactly when its change committed.
-- Consumers read events in (txid, id) order up to the oldest transaction still running
-- (pg_snapshot_xmin), so a slow transaction's event is never skipped by a cursor that moved past
-- it, and keep their position in _outbox_cursors.
CREATE TABLE _outbox (
  id         bigserial PRIMARY KEY,
  -- The writing transaction (xid8 as a number): orders events by commit horizon, see above.
  txid       bigint NOT NULL DEFAULT (pg_current_xact_id()::text::bigint),
  topic      text NOT NULL,
  -- What changed, e.g. 'board:<id>'. Consumers coalesce a batch to the newest event per key.
  key        text NOT NULL,
  payload    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX _outbox_order ON _outbox (txid, id);
CREATE INDEX _outbox_created ON _outbox (created_at);

CREATE TABLE _outbox_cursors (
  consumer   text PRIMARY KEY,
  txid       bigint NOT NULL DEFAULT 0,
  event_id   bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Versions handed to derivers: taken when a batch is read, so a derivation that read its source
-- later always carries a higher version (derived rows never go back to an older read).
CREATE SEQUENCE _outbox_derive_version;

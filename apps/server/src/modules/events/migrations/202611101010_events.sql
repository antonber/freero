-- The event stream (KAI-150): everything that happens to boards, recorded once, in order, for the
-- consumers that fan it out (webhooks today). Append-only. No foreign keys to what it names: like
-- the audit log, an event outlives the board or account it is about (retention prunes it).
CREATE TABLE events (
  id           bigserial PRIMARY KEY,
  -- The outbox event (or derivation) it came from: a replayed batch never records it twice.
  source_key   text NOT NULL UNIQUE,
  type         text NOT NULL,
  workspace_id text NOT NULL,
  board_id     text NOT NULL,
  -- freero://board/<id> or freero://board/<id>#<element>.
  object_uri   text NOT NULL,
  -- user | agent | system, or NULL when the saved content does not say who (item updates).
  actor_kind   text,
  actor_id     text,
  -- agent: the app or token acting for actor_id (its name as the board shows it).
  actor_app    text,
  data         jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_workspace ON events (workspace_id, id);
CREATE INDEX events_board ON events (board_id, id);
CREATE INDEX events_created ON events (created_at);

-- What the deriver last saw of each board's SAVED shared content (no layer, nothing under a hidden
-- frame): a fingerprint per item and the comment messages, compared with the next save to tell
-- item.created / item.updated / item.deleted and comment.created. Replaced whole.
CREATE TABLE event_board_states (
  board_id   text PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  items      jsonb NOT NULL,
  messages   jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);

-- Boards whose saved content changed and waits to settle (a drag is one update, not sixty).
CREATE TABLE event_pending_boards (
  board_id text PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  first_at timestamptz NOT NULL,
  due_at   timestamptz NOT NULL
);
CREATE INDEX event_pending_boards_due ON event_pending_boards (due_at);

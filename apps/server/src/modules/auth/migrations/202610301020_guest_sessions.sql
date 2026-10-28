-- Owned by modules/auth. Only modules/auth/repo.ts writes this table.
-- Guests: visitors without an account who joined ONE board through its shared link under a name.
-- The cookie `freero_guest` carries a random token; only its sha256 is stored. The id
-- ('guest_…', never an account id) is who they are on the board (presence, comment authorship).
-- Expired rows are purged (and their sockets closed) by a job; deleting the board ends them too.
CREATE TABLE guest_sessions (
  id         text PRIMARY KEY CHECK (id LIKE 'guest\_%'),
  token_hash text NOT NULL CONSTRAINT guest_sessions_token_hash_key UNIQUE,
  board_id   text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL,
  ip         text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX guest_sessions_board_id ON guest_sessions (board_id);
CREATE INDEX guest_sessions_expires_at ON guest_sessions (expires_at);

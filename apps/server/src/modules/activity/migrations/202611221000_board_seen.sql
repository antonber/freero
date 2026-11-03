-- Owned by modules/activity. Only modules/activity/repo.ts writes this table.
-- "Changes since your last visit": when each account last had a board open — the moment one of
-- their board sockets closed (realtime's onBoardLeft, a trusted server event). The board offers
-- what others changed since (read from board_activity). Guests have none.
CREATE TABLE board_seen (
  board_id text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  user_id  text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  seen_at  timestamptz NOT NULL,
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX board_seen_user ON board_seen (user_id); -- FK cascade

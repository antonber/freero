-- Owned by modules/activity. Only modules/activity/repo.ts writes this table.
-- The activity feed: what people did on a board, one row per person per burst of work ("Ann added
-- 12 sticky notes in frame 'Ideas'"), derived on the server from changes it applied from that
-- person's own socket (and from sharing events), never from what a client says it did.
-- `audience` 'editors': about the contents of hidden frames — shown to owners/editors only.
-- `actor_id` is an account id or a guest id (no FK: guests are not accounts); `actor_name` is kept
-- for guests only (accounts are named by their current profile when read).
CREATE TABLE board_activity (
  id         text PRIMARY KEY,
  board_id   text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  actor_id   text NOT NULL,
  actor_name text,
  kind       text NOT NULL CHECK (kind IN ('edit', 'comment', 'share')),
  audience   text NOT NULL CHECK (audience IN ('all', 'editors')),
  summary    jsonb NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at   timestamptz NOT NULL
);
CREATE INDEX board_activity_board_ended ON board_activity (board_id, ended_at DESC);
CREATE INDEX board_activity_ended ON board_activity (ended_at); -- retention
CREATE INDEX board_activity_actor ON board_activity (actor_id);

-- Owned by modules/notifications. Only modules/notifications/repo.ts writes this table.
-- A comment named the address of someone invited to the board who has no account yet (the
-- @ picker's "Invite … to comment"). When that invite becomes access, the row becomes a
-- `comment.mention` notification for the new member and is deleted.
CREATE TABLE pending_mentions (
  id         text PRIMARY KEY,
  board_id   text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  email      text NOT NULL CHECK (email = lower(email)),
  actor_id   text REFERENCES users (id) ON DELETE SET NULL,
  data       jsonb NOT NULL,          -- NotificationData (thread, message, excerpt, board title)
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT pending_mentions_once UNIQUE (board_id, email, dedupe_key)
);
CREATE INDEX pending_mentions_actor ON pending_mentions (actor_id);     -- FK set null
CREATE INDEX pending_mentions_created ON pending_mentions (created_at); -- expiry sweep

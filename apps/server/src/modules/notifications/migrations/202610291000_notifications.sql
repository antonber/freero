-- Owned by modules/notifications. Only modules/notifications/repo.ts writes these tables.
-- One row per notification per recipient. `type` is open-ended (see types.ts); `data` holds what
-- the inbox and the digest show, worded at creation (board title, comment excerpt, thread id).
CREATE TABLE notifications (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type       text NOT NULL,
  actor_id   text REFERENCES users (id) ON DELETE SET NULL,
  board_id   text REFERENCES boards (id) ON DELETE CASCADE,
  data       jsonb NOT NULL,
  -- Same event never notifies a person twice (a comment that both mentions and replies to you).
  dedupe_key text,
  created_at timestamptz NOT NULL,
  read_at    timestamptz,
  -- Set once the digest job has dealt with it (emailed, or skipped: read, opted out, unverified).
  emailed_at timestamptz,
  CONSTRAINT notifications_dedupe_key UNIQUE (user_id, dedupe_key)
);
CREATE INDEX notifications_user_created ON notifications (user_id, created_at DESC); -- inbox
CREATE INDEX notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL; -- badge
CREATE INDEX notifications_email_due ON notifications (created_at) WHERE emailed_at IS NULL; -- digest job
CREATE INDEX notifications_actor ON notifications (actor_id);   -- FK set null
CREATE INDEX notifications_board ON notifications (board_id);   -- FK cascade

-- Email preferences. No row = the default (emails on). type '*' is the master switch that the
-- one-click unsubscribe link turns off.
CREATE TABLE notification_prefs (
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type    text NOT NULL,
  email   boolean NOT NULL,
  PRIMARY KEY (user_id, type)
);

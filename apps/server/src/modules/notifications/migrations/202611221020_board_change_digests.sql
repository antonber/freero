-- Owned by modules/notifications. Only modules/notifications/repo.ts writes this table.
-- "Changes on your boards" emails people chose (no row: off, the default): a summary of what
-- others changed on boards they own or starred, each morning ('daily') or Monday morning
-- ('weekly') in their time zone. `last_sent_at`: the end of the window the last email covered
-- (or when they turned it on); the next one covers from there. `next_at`: when it is due (that
-- morning where they are, worked out when the window last moved).
CREATE TABLE board_change_digests (
  user_id      text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  frequency    text NOT NULL CHECK (frequency IN ('daily', 'weekly')),
  last_sent_at timestamptz NOT NULL,
  next_at      timestamptz NOT NULL
);
CREATE INDEX board_change_digests_next ON board_change_digests (next_at);

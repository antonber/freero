-- Owned by modules/members. Only modules/members/repo.ts writes this table.
-- The board owner is NOT stored here (boards.owner_id); rows hold invited members only.
CREATE TABLE IF NOT EXISTS board_members (
  board_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX IF NOT EXISTS board_members_user ON board_members(user_id);

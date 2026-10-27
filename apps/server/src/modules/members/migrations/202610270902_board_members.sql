-- Owned by modules/members. Only modules/members/repo.ts writes this table.
-- The board owner is NOT stored here (boards.owner_id); rows hold invited members only.
CREATE TABLE board_members (
  board_id   text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX board_members_user_id ON board_members (user_id);

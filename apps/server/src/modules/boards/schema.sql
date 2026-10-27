-- Owned by modules/boards. Only modules/boards/repo.ts writes these tables.
CREATE TABLE IF NOT EXISTS boards (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id    TEXT NOT NULL,
  link_access TEXT NOT NULL DEFAULT 'none' CHECK (link_access IN ('none', 'viewer', 'commenter', 'editor')),
  thumbnail   TEXT,                         -- /uploads URL of the last saved thumbnail
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS boards_owner ON boards(owner_id);

CREATE TABLE IF NOT EXISTS board_stars (
  board_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX IF NOT EXISTS board_stars_user ON board_stars(user_id);

CREATE TABLE IF NOT EXISTS board_opens (
  board_id  TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX IF NOT EXISTS board_opens_user ON board_opens(user_id);

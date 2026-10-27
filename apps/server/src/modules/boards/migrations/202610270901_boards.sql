-- Owned by modules/boards. Only modules/boards/repo.ts writes these tables.
CREATE TABLE boards (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  owner_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  link_access text NOT NULL DEFAULT 'none' CHECK (link_access IN ('none', 'viewer', 'commenter', 'editor')),
  thumbnail   text,                         -- uploads URL of the last saved thumbnail
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL
);
CREATE INDEX boards_owner_id ON boards (owner_id);

CREATE TABLE board_stars (
  board_id   text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX board_stars_user_id ON board_stars (user_id);

CREATE TABLE board_opens (
  board_id  text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  user_id   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  opened_at timestamptz NOT NULL,
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX board_opens_user_id ON board_opens (user_id);

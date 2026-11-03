-- Owned by modules/engage. Only modules/engage/repo.ts writes this table.
-- A quiz's answer key (#147): which options are right, per question. Everyone who can open a board
-- holds its document, so the key is kept here, not on the element, and published per question only
-- once its facilitator shows the answer. Copies of a board (duplicate, template) carry the
-- questions, not the key.
CREATE TABLE engage_keys (
  board_id    text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  activity_id text NOT NULL,
  -- question id -> right option ids
  answer_key  jsonb NOT NULL,
  updated_at  timestamptz NOT NULL,
  PRIMARY KEY (board_id, activity_id)
);

-- Owned by modules/ai. Only modules/ai/repo.ts writes this table.
--
-- The board assistant (#1): one person's conversation about one board — their questions and the
-- assistant's answers (which quote the board as that person saw it). Only that person ever reads
-- it; it goes with the board (deleted for good) or the account (purged), or when they clear it.
-- `body` is the message as JSON, sealed with the board's workspace key when it has one (#159):
-- answers are derived board text. `sealed_with` names the data key (NULL: stored as is).
CREATE TABLE ai_assistant_messages (
  n            bigserial PRIMARY KEY,
  id           text NOT NULL UNIQUE,
  board_id     text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL,
  sealed_with  text,
  body         bytea NOT NULL
);
CREATE INDEX ai_assistant_messages_conversation ON ai_assistant_messages (board_id, user_id, n);
CREATE INDEX ai_assistant_messages_user ON ai_assistant_messages (user_id);

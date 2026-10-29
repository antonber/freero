-- Owned by modules/realtime. Only modules/realtime/repo.ts writes this table.
-- Which boards hold pending suggestions an app or token proposed (KAI-224), so revoking that
-- credential withdraws them without loading every board. A HINT: written when a proposal is made
-- (proposeSuggestions), cleared when a room loads with none of that author's pending any more and
-- after a withdrawal; the editors layer itself is what decides. `credential_id` is the suggestion's
-- `author.credentialId` (a personal token's id, an app's client id), `user_id` the person it acted for.
CREATE TABLE board_suggestion_authors (
  board_id      text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  user_id       text NOT NULL,
  credential_id text NOT NULL,
  PRIMARY KEY (board_id, user_id, credential_id)
);
CREATE INDEX board_suggestion_authors_credential ON board_suggestion_authors (credential_id);
CREATE INDEX board_suggestion_authors_user ON board_suggestion_authors (user_id);

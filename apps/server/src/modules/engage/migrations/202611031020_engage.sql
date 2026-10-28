-- Owned by modules/engage. Only modules/engage/repo.ts writes these tables.
-- Live audience activities (KAI-132): answers never enter the board document. The server keeps
-- them here and publishes only results into the board (realtime's server-written collection).
-- `respondent_id` / `author_id` / `voter_id` are account ids or guest ids (no foreign key to users:
-- guests have no row there); a deleted account's answers are forgotten by the account purge.

-- One answer per person per activity: a new answer replaces it.
CREATE TABLE engage_answers (
  board_id        text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  activity_id     text NOT NULL,
  respondent_id   text NOT NULL,
  -- The name shown with the answer when it was given openly (anonymous: NULL, never stored).
  respondent_name text,
  value           jsonb NOT NULL,
  updated_at      timestamptz NOT NULL,
  PRIMARY KEY (board_id, activity_id, respondent_id)
);
CREATE INDEX engage_answers_respondent ON engage_answers (respondent_id); -- data export, purge

-- Q&A questions. `author_name` is NULL for a question asked anonymously.
CREATE TABLE engage_questions (
  id          text PRIMARY KEY,
  board_id    text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  activity_id text NOT NULL,
  author_id   text,
  author_name text,
  text        text NOT NULL,
  created_at  timestamptz NOT NULL,
  answered_at timestamptz,
  hidden_at   timestamptz
);
CREATE INDEX engage_questions_activity ON engage_questions (board_id, activity_id);
CREATE INDEX engage_questions_author ON engage_questions (author_id);

-- One upvote per person per question.
CREATE TABLE engage_upvotes (
  question_id text NOT NULL REFERENCES engage_questions (id) ON DELETE CASCADE,
  voter_id    text NOT NULL,
  created_at  timestamptz NOT NULL,
  PRIMARY KEY (question_id, voter_id)
);
CREATE INDEX engage_upvotes_voter ON engage_upvotes (voter_id);

-- Activities whose sealed results an editor revealed.
CREATE TABLE engage_reveals (
  board_id    text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  activity_id text NOT NULL,
  revealed_at timestamptz NOT NULL,
  PRIMARY KEY (board_id, activity_id)
);

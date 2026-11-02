-- Owned by modules/problems. Only modules/problems/repo.ts writes this table.
--
-- "Report a problem": a note from someone signed in, optionally a screenshot of what they saw
-- (`screenshot_key`: uploads' private area, never an /uploads URL) and the diagnostics the app
-- attached (JSON, validated and size-capped). Only operators read them. Closed reports (fixed,
-- wontfix, duplicate) are deleted PROBLEM_RETENTION_DAYS after `closed_at`, screenshot first.
-- The reporter's account going deletes theirs (the purge deletes the screenshots; rows cascade).
CREATE TABLE problem_reports (
  id             text PRIMARY KEY,
  user_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  note           text NOT NULL,
  contact_ok     boolean NOT NULL DEFAULT false,
  diagnostics    jsonb NOT NULL,
  screenshot_key text,
  status         text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'fixed', 'wontfix', 'duplicate')),
  operator_note  text NOT NULL DEFAULT '',
  issue_url      text,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  closed_at      timestamptz
);
CREATE INDEX problem_reports_status ON problem_reports (status, created_at DESC, id DESC);
CREATE INDEX problem_reports_created ON problem_reports (created_at DESC, id DESC);
CREATE INDEX problem_reports_user ON problem_reports (user_id, created_at DESC);
CREATE INDEX problem_reports_closed ON problem_reports (closed_at) WHERE closed_at IS NOT NULL;

-- Owned by modules/problems. Only modules/problems/repo.ts writes this table.
--
-- Screenshots whose problem report is gone (retention, account deletion, an attach that lost a
-- race) and whose file is still to be deleted. A key goes in with the report's deletion, in the
-- same statement, and leaves only once its file's delete succeeded, so a storage error never
-- leaves a screenshot behind: the problems:retention job deletes what is left (#192).
CREATE TABLE problem_screenshot_deletions (
  key   text PRIMARY KEY,
  since timestamptz NOT NULL
);
CREATE INDEX problem_screenshot_deletions_since ON problem_screenshot_deletions (since);

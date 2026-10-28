-- Owned by modules/auth. Only modules/auth/repo.ts writes this table.
-- previous_names: the last few names the account had before its current one, newest first
-- (KAI-187). A comment may carry its author's own name only; a board tab opened before a rename
-- elsewhere still writes the old one, so the comment rules accept these too.
ALTER TABLE users ADD COLUMN previous_names text[] NOT NULL DEFAULT '{}';

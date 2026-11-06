-- Owned by modules/auth. Only modules/auth/repo.ts writes this table.
-- discovery_source: the answer to "How did you find Freero?", the optional question on the sign-up
-- form (DISCOVERY_SOURCES in @freero/shared). Null: not answered, or the account was made without
-- the form (a provider, single sign-on, a directory). Counted by `npm run admin -- signups:sources`.
-- Nullable without a default, so adding it rewrites no rows; the constraint allows only the fixed
-- answers (a new answer is a new migration, in step with DISCOVERY_SOURCES).
ALTER TABLE users ADD COLUMN IF NOT EXISTS discovery_source text
  CONSTRAINT users_discovery_source_check
  CHECK (discovery_source IN ('search', 'ai_assistant', 'colleague', 'social', 'open_source', 'directory', 'other'));

-- Owned by modules/auth. Email verification, password reset, session management, account deletion.

-- When the user proved they read mail sent to `email` (null = not verified).
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
-- Set while the account is in its deletion grace period: purged (hard-deleted) after this instant.
ALTER TABLE users ADD COLUMN deletion_scheduled_for timestamptz;
CREATE INDEX users_deletion_scheduled_for ON users (deletion_scheduled_for) WHERE deletion_scheduled_for IS NOT NULL;

-- Sessions get a public id (listed and revoked by it; the token hash never leaves the server),
-- a last-seen time and the device they were opened from.
ALTER TABLE sessions ADD COLUMN id text;
UPDATE sessions SET id = substr(token_hash, 1, 24);
ALTER TABLE sessions ALTER COLUMN id SET NOT NULL;
ALTER TABLE sessions ADD CONSTRAINT sessions_id_key UNIQUE (id);
ALTER TABLE sessions ADD COLUMN last_seen_at timestamptz;
UPDATE sessions SET last_seen_at = created_at;
ALTER TABLE sessions ALTER COLUMN last_seen_at SET NOT NULL;
ALTER TABLE sessions ADD COLUMN user_agent text NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN ip text NOT NULL DEFAULT '';

-- Single-use emailed tokens. Only a sha256 of the token is stored; using one deletes its row.
CREATE TABLE auth_tokens (
  token_hash text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify_email', 'change_email', 'reset_password')),
  email      text NOT NULL,            -- the address the link was sent to (change_email: the new one)
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_tokens_user_id ON auth_tokens (user_id);
CREATE INDEX auth_tokens_expires_at ON auth_tokens (expires_at);

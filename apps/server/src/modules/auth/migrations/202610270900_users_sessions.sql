-- Owned by modules/auth. Only modules/auth/repo.ts writes these tables.
CREATE TABLE users (
  id            text PRIMARY KEY,
  email         text NOT NULL CONSTRAINT users_email_key UNIQUE CHECK (email = lower(email)),
  name          text NOT NULL,
  password_hash text NOT NULL,             -- scrypt$N$r$p$salt$key
  color         text NOT NULL,
  avatar_url    text,
  created_at    timestamptz NOT NULL
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,             -- sha256 of the cookie value; the raw token is never stored
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_id ON sessions (user_id);      -- FK cascade, per-user session lists
CREATE INDEX sessions_expires_at ON sessions (expires_at); -- purge of expired sessions

-- Owned by modules/auth. Only modules/auth/repo.ts writes these tables.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,      -- stored lowercased
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,             -- scrypt$N$r$p$salt$key
  color         TEXT NOT NULL,
  avatar_url    TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,             -- sha256 of the cookie value; the raw token is never stored
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

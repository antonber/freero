-- Owned by modules/auth. An operator suspended the account (modules/moderation calls
-- auth's suspendUser): it can't sign in, every session it had was ended, and a session row that
-- slipped in meanwhile never resolves (sessions of suspended accounts are ignored). Restoring the
-- account clears it.
ALTER TABLE users ADD COLUMN suspended_at timestamptz;

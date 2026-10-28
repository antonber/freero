-- Owned by modules/auth. Ways back into an account whose two-step verification its owner can't
-- pass (KAI-99): the "this wasn't me" link of the two-step-on notice, and the delayed recovery
-- that removes two-step verification after a waiting period.

-- two_factor_undo: the "this wasn't me" link of the two-step-on notice (`email` = the verified
--   address it went to, created_at = the enabled_at of the enrolment it undoes).
-- two_factor_recovery: the link that finishes a delayed recovery, mailed once it is ready.
-- two_factor_recovery_cancel: the link in the "recovery started" mail that cancels it.
ALTER TABLE auth_tokens DROP CONSTRAINT auth_tokens_purpose_check;
ALTER TABLE auth_tokens ADD CONSTRAINT auth_tokens_purpose_check
  CHECK (purpose IN ('verify_email', 'change_email', 'reset_password', 'revert_email',
                     'two_factor_undo', 'two_factor_recovery', 'two_factor_recovery_cancel'));

-- Set when the password was last set through an emailed link (reset, "this wasn't me"): it proves
-- the mailbox, not knowledge of the password. Cleared when a sign-in passes the second step, the
-- password is changed from a session, or two-step verification is turned on. A delayed recovery
-- can't be started with such a password, so the mailbox alone never starts one.
ALTER TABLE users ADD COLUMN password_via_link_at timestamptz;

-- A delayed two-step verification recovery in progress (one per account).
CREATE TABLE auth_two_factor_recoveries (
  user_id        text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  started_at     timestamptz NOT NULL,
  ready_at       timestamptz NOT NULL,      -- two-step verification can be removed from then on
  requested_from text NOT NULL,             -- "Chrome on Windows · Lyon, France" (for the reminder)
  reminded_at    timestamptz,               -- the "completes soon" mail went out
  ready_sent_at  timestamptz                -- the link that finishes it went out
);
CREATE INDEX auth_two_factor_recoveries_ready_at ON auth_two_factor_recoveries (ready_at);

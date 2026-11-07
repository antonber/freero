-- A digest the mail server refused is tried again after a growing wait (`email_retry_at`), not on
-- every run, and given up on after a few attempts (`email_attempts`): its notifications are then
-- left as dealt with (they stay in the inbox). Existing rows start at no attempts.
ALTER TABLE notifications ADD COLUMN email_attempts smallint NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN email_retry_at timestamptz;

-- Owned by modules/boards. #154: when the owner was last told that a retention rule will archive or
-- trash the board. A notice older than the board's last activity no longer counts (activity resets
-- the clock), so the rule waits for a fresh notice and RETENTION_NOTICE_DAYS more.
ALTER TABLE boards ADD COLUMN retention_notice_at timestamptz;

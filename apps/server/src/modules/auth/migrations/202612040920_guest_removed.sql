-- Owned by modules/auth.
-- #97: a guest its board's owner removed. The row stays until it expires (the purge job deletes it
-- then), so the same browser can't simply join the board again; it is no live guest meanwhile.
ALTER TABLE guest_sessions ADD COLUMN removed_at timestamptz;

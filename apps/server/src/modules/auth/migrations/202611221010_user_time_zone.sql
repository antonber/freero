-- Owned by modules/auth. Only modules/auth/repo.ts writes this table.
-- time_zone: the account's IANA time zone ("Europe/Berlin"), detected by the app from the browser
-- or chosen in the profile. Due-date reminders, the "changes on your boards" email and dates in
-- emails follow it; NULL (not known yet) reads as UTC.
ALTER TABLE users ADD COLUMN time_zone text;

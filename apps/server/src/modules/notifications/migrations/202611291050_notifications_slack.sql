-- Personal Slack (#105): a notification goes to Slack as a direct message or into the email digest,
-- never both. `slacked_at` is set when it is claimed for Slack (cleared again if Slack refused it,
-- so the digest still emails it). Preferences get a Slack switch per type beside the email one; a
-- row may set only one of them (null = that channel's default).
ALTER TABLE notifications ADD COLUMN slacked_at timestamptz;
ALTER TABLE notification_prefs ADD COLUMN slack boolean;
ALTER TABLE notification_prefs ALTER COLUMN email DROP NOT NULL;

-- Owned by modules/auth. Only modules/auth/repo.ts writes this table.
-- color_theme: how the app looks for this person (system / light / dark), kept with the account so
-- it follows them to every device. Existing accounts follow their device.
ALTER TABLE users ADD COLUMN color_theme text NOT NULL DEFAULT 'system'
  CHECK (color_theme IN ('system', 'light', 'dark'));

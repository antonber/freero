-- Owned by modules/mobile. Only modules/mobile/repo.ts writes this table.
-- Push notifications to Freero's phone and tablet apps (#177; docs/mobile.md).

-- One row per device that asked for push notifications: its APNs / FCM token (a device's token is
-- one person's: registering it again from another account moves it), the session it was registered
-- in (the row goes when that session ends: sign-out, "sign out everywhere", a password change…) and
-- the notification types the person turned off on this device.
CREATE TABLE push_devices (
  token       text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_key text NOT NULL,
  platform    text NOT NULL CHECK (platform IN ('ios', 'android')),
  off_types   jsonb NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL
);
CREATE INDEX push_devices_user ON push_devices (user_id);
CREATE INDEX push_devices_session ON push_devices (session_key);

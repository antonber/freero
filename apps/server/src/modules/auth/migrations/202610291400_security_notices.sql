-- Owned by modules/auth. Security notices: the browsers that have signed in to an account (a
-- sign-in from any other browser is mailed to the owner) and the "this wasn't me" link that an
-- email change sends to the previous address.

-- A browser that signed in to the account: the sha256 of its long-lived device cookie.
CREATE TABLE auth_devices (
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_hash  text NOT NULL,
  created_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, device_hash)
);
CREATE INDEX auth_devices_last_seen_at ON auth_devices (last_seen_at); -- pruning

-- revert_email: sent to the previous address after an email change; `email` is that address and
-- created_at the moment of the change.
ALTER TABLE auth_tokens DROP CONSTRAINT auth_tokens_purpose_check;
ALTER TABLE auth_tokens ADD CONSTRAINT auth_tokens_purpose_check
  CHECK (purpose IN ('verify_email', 'change_email', 'reset_password', 'revert_email'));

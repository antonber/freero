-- Owned by modules/boards. Only modules/boards/repo.ts writes these tables.
--
-- Share-link protection (KAI-145), on the board's link settings:
--   link_password_hash   scrypt hash (auth's password hashing) of the link's password, or NULL.
--                        While set, the link grants its role only to people (accounts or guests)
--                        holding an unlock for the CURRENT password (board_link_unlocks below).
--   link_password_rev    bumped whenever the password is set, changed or removed: unlocks made
--                        under an earlier revision stop counting at once.
--   link_expires_at      after this instant the link grants nothing (members keep their access);
--   link_expiry_applied_at  when the expiry job last re-checked the live sockets for this expiry.
--
-- Per-board call link (KAI-134):
--   call_url             an https meeting link the board's editors set (Meet, Zoom, Teams, Jitsi…);
--   call_jitsi           true: use a room on the operator's Jitsi (JITSI_BASE_URL) whose name is
--                        derived from the board id with the server's secret (not guessable).
ALTER TABLE boards ADD COLUMN link_password_hash text;
ALTER TABLE boards ADD COLUMN link_password_rev integer NOT NULL DEFAULT 0;
ALTER TABLE boards ADD COLUMN link_expires_at timestamptz;
ALTER TABLE boards ADD COLUMN link_expiry_applied_at timestamptz;
ALTER TABLE boards ADD COLUMN call_url text;
ALTER TABLE boards ADD COLUMN call_jitsi boolean NOT NULL DEFAULT false;
-- The expiry job finds links that expired and whose sockets were not re-checked yet.
CREATE INDEX boards_link_expires_at ON boards (link_expires_at) WHERE link_expires_at IS NOT NULL;

-- Someone (an account id or a guest id: no foreign key to users) who gave the link's password,
-- for the password revision they gave it for. One row per board and person.
CREATE TABLE board_link_unlocks (
  board_id     text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  principal_id text NOT NULL,
  password_rev integer NOT NULL,
  unlocked_at  timestamptz NOT NULL,
  PRIMARY KEY (board_id, principal_id)
);
CREATE INDEX board_link_unlocks_principal ON board_link_unlocks (principal_id);

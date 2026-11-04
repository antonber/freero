-- Owned by modules/zoom.
-- The board a Zoom meeting's participant opened for everyone (#168): the Zoom app's invitation opens
-- the app for the others, and their app asks which board this meeting has. Only the sha256 of
-- Zoom's meeting UUID is kept (it is known to the meeting's participants only), for a day; the row
-- names a board, and what each person sees of it is still the board's own sharing.
CREATE TABLE zoom_meeting_boards (
  meeting_key text PRIMARY KEY,
  board_id text NOT NULL,
  set_by text NOT NULL,
  set_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX zoom_meeting_boards_expiry ON zoom_meeting_boards (expires_at);

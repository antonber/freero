-- Owned by modules/members. Only modules/members/repo.ts writes this table.
-- Pending invites for addresses without a Freero account. The emailed link carries a random token;
-- only its sha256 is stored. Accepting (or verifying that address) deletes the row: single use.
CREATE TABLE board_invites (
  id         text PRIMARY KEY,
  board_id   text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  email      text NOT NULL CHECK (email = lower(email)),
  role       text NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')),
  token_hash text NOT NULL CONSTRAINT board_invites_token_hash_key UNIQUE,
  invited_by text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT board_invites_board_email_key UNIQUE (board_id, email)
);
CREATE INDEX board_invites_email ON board_invites (email);           -- conversion when an address is verified
CREATE INDEX board_invites_invited_by ON board_invites (invited_by); -- FK cascade

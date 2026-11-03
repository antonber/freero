-- Owned by modules/embed.
-- Boards embedded live on other sites (#2): a person who signs in from an embed (the first-party
-- popup /embed/connect/:id) hands the frame a token for THAT board. It acts for the session that
-- made it (session_key: auth's key of that session, the sha256 of its cookie) and ends with it;
-- `max_role` caps it ('viewer' when the embedder asked for a read-only embed). Only sha256 of the
-- token is stored.
CREATE TABLE embed_member_tokens (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL,
  session_key text NOT NULL,
  board_id text NOT NULL,
  max_role text NOT NULL CHECK (max_role IN ('viewer', 'owner')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX embed_member_tokens_expiry ON embed_member_tokens (expires_at);
CREATE INDEX embed_member_tokens_session ON embed_member_tokens (session_key);

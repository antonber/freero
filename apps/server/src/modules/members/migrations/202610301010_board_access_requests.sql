-- Owned by modules/members. Only modules/members/repo.ts writes this table.
-- "Request access": someone signed in who can't open a board asks for it. One row per (board,
-- person): at most one PENDING request each. A decided request keeps its outcome (the approvers'
-- notifications show it) until the person asks again.
CREATE TABLE board_access_requests (
  board_id     text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The role they asked for (approvers may grant another).
  role         text NOT NULL CHECK (role IN ('editor', 'commenter', 'viewer')),
  message      text NOT NULL DEFAULT '',
  status       text NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
  created_at   timestamptz NOT NULL,
  decided_by   text REFERENCES users (id) ON DELETE SET NULL,
  decided_role text CHECK (decided_role IN ('editor', 'commenter', 'viewer')),
  decided_at   timestamptz,
  PRIMARY KEY (board_id, user_id)
);
CREATE INDEX board_access_requests_user_id ON board_access_requests (user_id);
CREATE INDEX board_access_requests_decided_by ON board_access_requests (decided_by);
CREATE INDEX board_access_requests_pending ON board_access_requests (board_id) WHERE status = 'pending';

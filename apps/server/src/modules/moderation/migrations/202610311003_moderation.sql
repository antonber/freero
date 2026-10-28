-- Owned by modules/moderation. Only modules/moderation/repo.ts writes these tables.
-- The state of moderated things (a board taken down, a link blocked, a file removed, an account
-- suspended) lives in the modules that own them; these tables hold the queue and the record.

-- The queue: reports from people who can open a board, and appeals against actions. Board ids
-- are kept without a foreign key: the record outlives the board.
CREATE TABLE moderation_items (
  id              text PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('report', 'appeal')),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  board_id        text,
  board_title     text NOT NULL DEFAULT '',
  target_kind     text NOT NULL CHECK (target_kind IN ('board', 'element', 'upload', 'comment', 'user')), -- 'user': appeals against a suspension
  target_id       text,
  reason          text,                                   -- reports: a ReportReason
  message         text NOT NULL DEFAULT '',               -- the reporter's note / the appeal
  reporter_id     text REFERENCES users (id) ON DELETE SET NULL,
  reporter_key    text,                                   -- HMAC of the reporter's address (never the address)
  contact_email   text,                                   -- visitors without an account, optional
  action_id       text,                                   -- appeals: the action appealed against
  -- One open item per reporter and target (a repeated report adds nothing), one open appeal per action.
  dedupe_key      text NOT NULL,
  created_at      timestamptz NOT NULL,
  resolved_at     timestamptz,
  resolved_by     text REFERENCES users (id) ON DELETE SET NULL,
  resolution_note text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX moderation_items_open_dedupe ON moderation_items (dedupe_key) WHERE status = 'open';
CREATE INDEX moderation_items_open ON moderation_items (created_at) WHERE status = 'open';
CREATE INDEX moderation_items_resolved ON moderation_items (resolved_at) WHERE status <> 'open';
CREATE INDEX moderation_items_board_id ON moderation_items (board_id);

-- Every operator action, append-only (never updated or deleted): who did what to what, when and
-- why, and what the person affected was told. The seam for an audit log (KAI-48) is
-- onModerationAction in this module's index.
CREATE TABLE moderation_actions (
  id              text PRIMARY KEY,
  action          text NOT NULL,                          -- a ModerationActionKind
  target_id       text NOT NULL,                          -- board id, upload name or user id
  board_id        text,
  subject_user_id text REFERENCES users (id) ON DELETE SET NULL,
  operator_id     text REFERENCES users (id) ON DELETE SET NULL,
  reason          text NOT NULL,
  statement       text NOT NULL,                          -- sent to the person affected
  note            text NOT NULL DEFAULT '',               -- operators only
  item_id         text,
  created_at      timestamptz NOT NULL
);
CREATE INDEX moderation_actions_target ON moderation_actions (target_id, created_at);
CREATE INDEX moderation_actions_board_id ON moderation_actions (board_id) WHERE board_id IS NOT NULL;

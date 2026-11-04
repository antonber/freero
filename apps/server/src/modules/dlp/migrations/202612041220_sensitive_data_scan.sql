-- Owned by modules/dlp. Only modules/dlp/repo.ts writes these tables.
--
-- #158 (docs/design/compliance.md §2): the optional sensitive-data scan of a team workspace's boards.
-- A finding says WHERE (board, item) and WHAT KIND, and how many — never the text that matched.

-- A workspace's scan: off until its content admins turn it on. label_id names one of
-- workspaces' classification labels (checked when set; a label deleted since means none).
CREATE TABLE dlp_settings (
  workspace_id text PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  enabled      boolean NOT NULL,
  kinds        text[] NOT NULL,
  action       text NOT NULL CHECK (action IN ('notify', 'suggest', 'require')),
  label_id     text,
  updated_by   text REFERENCES users (id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL
);

-- The last derivation of each scanned board (the outbox consumer's version, so an older one never
-- replaces a newer one) and the workspace it was scanned for.
CREATE TABLE dlp_board_scans (
  board_id     text PRIMARY KEY REFERENCES boards (id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  version      bigint NOT NULL,
  scanned_at   timestamptz NOT NULL
);
CREATE INDEX dlp_board_scans_workspace ON dlp_board_scans (workspace_id);

-- item_key: '' (the board itself: its title), an element id, or 'c:<thread>:<message>' (a comment).
CREATE TABLE dlp_findings (
  board_id       text NOT NULL REFERENCES dlp_board_scans (board_id) ON DELETE CASCADE,
  item_key       text NOT NULL,
  element_id     text,
  kind           text NOT NULL,
  count          integer NOT NULL CHECK (count > 0),
  first_found_at timestamptz NOT NULL,
  PRIMARY KEY (board_id, item_key, kind)
);

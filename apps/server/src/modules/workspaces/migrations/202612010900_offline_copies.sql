-- Owned by modules/workspaces. #178: may people keep copies of the workspace's boards on their
-- devices to work offline ('all' | 'unkeyed' | 'off'). NULL: the default — 'unkeyed' on a team
-- workspace (allowed unless it keeps its boards under its own encryption key), no floor on an
-- organisation's row.
ALTER TABLE workspaces ADD COLUMN offline_copies text
  CHECK (offline_copies IN ('all', 'unkeyed', 'off'));

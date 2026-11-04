-- Owned by modules/workspaces.
-- Guest editing (#97): may a board's owner let visitors without an account on its "can edit" link
-- edit ('on': each board decides, and starts off) or not ('off': guests stay commenters). On an
-- organisation it is a floor like every policy.
ALTER TABLE workspaces ADD COLUMN guest_editing text NOT NULL DEFAULT 'on'
  CHECK (guest_editing IN ('on', 'off'));

-- Owned by modules/boards.
-- Guest editing (#97): the board's owner (or a co-owner) lets visitors without an account on its
-- "can edit" link edit. Off by default; it only works while the link is "can edit" and the
-- workspace's `guestEditing` policy and the operator allow it (decided when access is resolved).
ALTER TABLE boards ADD COLUMN guests_can_edit boolean NOT NULL DEFAULT false;

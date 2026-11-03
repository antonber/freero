-- Owned by modules/boards.
-- A board's own sharing settings (#123), set by its owner and co-owners, always within its
-- workspace's policies (a board can be stricter than its workspace, never looser):
--   editors_can_share   editors may invite people (owners and co-owners always may);
--   viewers_can_export  viewers and commenters (guests too) may copy, duplicate, export, back up
--                       and download files from it.
ALTER TABLE boards ADD COLUMN editors_can_share boolean NOT NULL DEFAULT true;
ALTER TABLE boards ADD COLUMN viewers_can_export boolean NOT NULL DEFAULT true;

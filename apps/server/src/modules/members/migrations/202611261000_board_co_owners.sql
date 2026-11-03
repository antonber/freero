-- Owned by modules/members.
-- Board co-owners (#122): an editor membership that also manages the board's sharing. Kept apart
-- from `role` (which stays 'editor') so an instance that doesn't know co-owners yet, during a
-- rolling deploy, reads them as the editors they also are: never as owners.
ALTER TABLE board_members ADD COLUMN co_owner boolean NOT NULL DEFAULT false;

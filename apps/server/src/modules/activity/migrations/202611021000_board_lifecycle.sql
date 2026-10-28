-- Owned by modules/activity. The feed also tells what happened to a board as a whole (KAI-188):
-- kind 'board', summary { action: created | duplicated | renamed | moved | trashed | restored |
-- version_restored, from?, to?, version? }.
ALTER TABLE board_activity DROP CONSTRAINT board_activity_kind_check;
ALTER TABLE board_activity ADD CONSTRAINT board_activity_kind_check CHECK (kind IN ('edit', 'comment', 'share', 'board'));

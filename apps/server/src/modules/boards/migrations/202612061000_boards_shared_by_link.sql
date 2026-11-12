-- The operators' "Public links" view (modules/moderation): boards whose link grants access, newest
-- update first. Only boards with a link set and in service are in the index, so it stays small.
CREATE INDEX boards_shared_by_link ON boards (updated_at DESC, id DESC)
  WHERE link_access <> 'none' AND link_blocked_at IS NULL AND deleted_at IS NULL AND removed_at IS NULL;

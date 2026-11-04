-- Owned by modules/moderation. Community templates (#162, modules/gallery) can be reported like
-- listings: a report (and an appeal against a template's removal) is about target 'gallery', with
-- no board.
ALTER TABLE moderation_items DROP CONSTRAINT moderation_items_target_kind_check;
ALTER TABLE moderation_items ADD CONSTRAINT moderation_items_target_kind_check
  CHECK (target_kind IN ('board', 'element', 'upload', 'comment', 'user', 'listing', 'gallery'));

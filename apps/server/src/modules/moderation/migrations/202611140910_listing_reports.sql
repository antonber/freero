-- Owned by modules/moderation. Community listings (#87, modules/marketplace) can be reported like
-- board content: a report (and an appeal against a listing's removal) is about target 'listing',
-- with no board. The constraint is the one Postgres named for the column's CHECK.
ALTER TABLE moderation_items DROP CONSTRAINT moderation_items_target_kind_check;
ALTER TABLE moderation_items ADD CONSTRAINT moderation_items_target_kind_check
  CHECK (target_kind IN ('board', 'element', 'upload', 'comment', 'user', 'listing'));

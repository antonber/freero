-- Owned by modules/moderation. Only modules/moderation/repo.ts writes this table.
--
-- subject_name / subject_email: whom the action was about, as they were when it was taken
--   (KAI-178): the record keeps naming them after their account is deleted, when subject_user_id
--   turns NULL. NULL on actions recorded before this column existed.
-- parent_id: the action this one was taken as part of (KAI-180): the boards a suspension took
--   down (or whose link it turned off) with it, which lifting that suspension undoes together.
ALTER TABLE moderation_actions ADD COLUMN subject_name text;
ALTER TABLE moderation_actions ADD COLUMN subject_email text;
ALTER TABLE moderation_actions ADD COLUMN parent_id text;
CREATE INDEX moderation_actions_parent_id ON moderation_actions (parent_id) WHERE parent_id IS NOT NULL;

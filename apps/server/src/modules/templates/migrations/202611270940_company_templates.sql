-- Owned by modules/templates. #155: company templates — a template published to an organisation
-- (#108) appears in every attached workspace's picker under its name. Admins lock one (others use it,
-- nobody but admins changes or removes it) and retire one (out of every picker, kept).
ALTER TABLE templates ADD COLUMN organisation_id text REFERENCES workspaces (id) ON DELETE SET NULL;
ALTER TABLE templates ADD COLUMN published_by text;
ALTER TABLE templates ADD COLUMN locked boolean NOT NULL DEFAULT false;
ALTER TABLE templates ADD COLUMN retired_at timestamptz;
CREATE INDEX templates_organisation_id ON templates (organisation_id) WHERE organisation_id IS NOT NULL;

-- Owned by modules/templates. Only modules/templates/repo.ts writes this table.
-- A saved template: a snapshot of board content (a whole board or a selection) its owner can
-- insert into any board. Independent of the board it came from: deleting or purging that board
-- leaves the template alone.
-- Visibility is personal (owner_id) for now. Workspaces (KAI-37) will add the workspace a
-- template is shared with here, and widen the one visibility predicate in repo.ts.
CREATE TABLE templates (
  id            text PRIMARY KEY,
  owner_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text NOT NULL DEFAULT '',
  thumbnail     text,                    -- /uploads URL of the preview image
  content       jsonb NOT NULL,          -- TemplateContent (@freero/shared), opaque to the server
  element_count integer NOT NULL,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL
);
CREATE INDEX templates_owner_id ON templates (owner_id);

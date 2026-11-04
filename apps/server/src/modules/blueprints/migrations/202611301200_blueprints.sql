-- Owned by modules/blueprints (#161). A blueprint is a whole working setup saved for reuse: the
-- boards and docs of a project (their content as it was, without comments or session state), a
-- description and the steps to follow. Personal (workspace_id NULL) or shared with one team
-- workspace, like a team template. Using one makes a project with copies of every item.
CREATE TABLE blueprints (
  id           text PRIMARY KEY,
  owner_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id text REFERENCES workspaces (id) ON DELETE SET NULL,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  steps        jsonb NOT NULL DEFAULT '[]',
  created_at   timestamptz NOT NULL,
  updated_at   timestamptz NOT NULL
);
CREATE INDEX blueprints_owner ON blueprints (owner_id);
CREATE INDEX blueprints_workspace ON blueprints (workspace_id) WHERE workspace_id IS NOT NULL;

-- Its boards and docs, in order. `source_id`: the board it was saved from, only so links between
-- the items can be pointed at the copies when it is used (never opened through it).
CREATE TABLE blueprint_items (
  blueprint_id text NOT NULL REFERENCES blueprints (id) ON DELETE CASCADE,
  position     integer NOT NULL,
  source_id    text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('board', 'doc')),
  title        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  state        bytea,
  PRIMARY KEY (blueprint_id, position)
);

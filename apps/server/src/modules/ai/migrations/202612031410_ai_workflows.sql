-- Owned by modules/ai. Only modules/ai/repo.ts writes this table.
--
-- Saved AI workflows (#1): a named instruction for the board assistant that a person runs again
-- from any board's menu ("Turn this retro into action items"), on the whole board or on the items
-- selected. Its owner may share it with one team workspace they are a full member of; it stops
-- being shared there when they leave it. Running one never writes the board: its result is always
-- pending suggestions.
CREATE TABLE ai_workflows (
  id            text PRIMARY KEY,
  owner_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id  text REFERENCES workspaces (id) ON DELETE SET NULL,
  name          text NOT NULL,
  prompt        text NOT NULL,
  scope         text NOT NULL CHECK (scope IN ('board', 'selection')),
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL
);
CREATE INDEX ai_workflows_owner ON ai_workflows (owner_id, updated_at);
CREATE INDEX ai_workflows_workspace ON ai_workflows (workspace_id, updated_at) WHERE workspace_id IS NOT NULL;

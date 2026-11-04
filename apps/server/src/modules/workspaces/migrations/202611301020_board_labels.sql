-- Owned by modules/workspaces. #158: classification labels of a team workspace or an organisation
-- (an organisation's are available to all its workspaces). `caps`: the most a board carrying the
-- label may allow (a partial set of the floored policies, plus viewerExports), applied on top of the
-- workspace's effective policies wherever access is decided. Boards point at a label
-- (boards.label_id, modules/boards); a label in use can't be deleted.
CREATE TABLE workspace_labels (
  id           text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL,
  color        text NOT NULL,
  description  text NOT NULL DEFAULT '',
  caps         jsonb NOT NULL DEFAULT '{}',
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL
);
CREATE INDEX workspace_labels_workspace ON workspace_labels (workspace_id, position);
CREATE UNIQUE INDEX workspace_labels_name ON workspace_labels (workspace_id, lower(name));

-- Whether its boards must carry a label (an organisation's `required` is a floor for its
-- workspaces), and the label new boards get. One row per place that set either.
CREATE TABLE workspace_label_settings (
  workspace_id     text PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  required         boolean NOT NULL DEFAULT false,
  default_label_id text REFERENCES workspace_labels (id) ON DELETE SET NULL
);

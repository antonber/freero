-- Owned by modules/boards. #158: a board's classification label (modules/workspaces'
-- workspace_labels). RESTRICT: a label boards carry can't be deleted (relabel them first).
ALTER TABLE boards ADD COLUMN label_id text REFERENCES workspace_labels (id) ON DELETE RESTRICT;
CREATE INDEX boards_label ON boards (label_id) WHERE label_id IS NOT NULL;

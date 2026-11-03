-- Owned by modules/workspaces. #154: retention of inactive boards — after inactive_board_days
-- without activity a board is archived or moved to the trash ('none': no rule). On an
-- organisation's row both are floors for its workspaces (the stricter action, the shorter period).
ALTER TABLE workspaces ADD COLUMN inactive_board_action text NOT NULL DEFAULT 'none'
  CHECK (inactive_board_action IN ('none', 'archive', 'trash'));
ALTER TABLE workspaces ADD COLUMN inactive_board_days integer CHECK (inactive_board_days > 0);
CREATE INDEX workspaces_inactive_board_rule ON workspaces (id) WHERE inactive_board_action <> 'none';

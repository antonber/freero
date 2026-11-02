-- Owned by modules/personalviews. Only modules/personalviews/repo.ts writes this table.
--
-- A person's own view settings on a board (docs/design/kanban-fields-and-views.md, decision 2):
-- their unsaved changes to the view an item saves for everyone (a kanban's board view: which
-- fields cards show, what colours them). Never part of the board doc, so viewers may keep them and
-- nobody else ever reads them; here so they follow the person to their other devices. `settings`
-- is opaque JSON the board's features validate (size-capped by the service). Deleting the account
-- or the board deletes them.
CREATE TABLE personal_views (
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  board_id   text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  item_id    text NOT NULL,
  view_id    text NOT NULL,
  settings   jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, board_id, item_id, view_id)
);
CREATE INDEX personal_views_board ON personal_views (board_id);

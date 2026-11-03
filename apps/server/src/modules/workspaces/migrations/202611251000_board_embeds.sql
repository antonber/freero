-- Owned by modules/workspaces.
-- Board embeds (#2): whether the workspace's boards may be embedded live on other sites (a board's
-- owner turns embedding on per board); 'off' keeps every board out of other sites' frames.
ALTER TABLE workspaces ADD COLUMN board_embeds text NOT NULL DEFAULT 'on'
  CHECK (board_embeds IN ('on', 'off'));

-- Owned by modules/shapepacks. Only modules/shapepacks/repo.ts writes these tables.
--
-- A workspace's own shape packs (#4): named sets of icons its owners / admins upload as SVGs. Only
-- the sanitised drawing is kept (the primitives an icon element may draw, see @freero/shared
-- icons.ts), never the uploaded file: the upload is read once and deleted. A placed icon holds its
-- own drawing, so removing a pack (or its workspace) leaves the icons on boards alone.
CREATE TABLE shape_packs (
  id            text PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name          text NOT NULL,
  created_by    text REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL,
  -- Characters of all the pack's drawings (the workspace's total is capped).
  chars         integer NOT NULL
);
CREATE INDEX shape_packs_workspace_id ON shape_packs (workspace_id, created_at);

CREATE TABLE shape_pack_icons (
  pack_id   text NOT NULL REFERENCES shape_packs (id) ON DELETE CASCADE,
  position  integer NOT NULL,
  name      text NOT NULL,
  view_box  text NOT NULL,
  art       text NOT NULL CHECK (art IN ('mono', 'color')),
  nodes     jsonb NOT NULL,
  PRIMARY KEY (pack_id, position)
);

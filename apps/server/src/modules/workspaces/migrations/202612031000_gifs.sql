-- Owned by modules/workspaces.
-- GIF search (#139): 'off', or the highest content rating GIF search results may have ('g' or
-- 'pg-13'). Only matters where the operator configured a GIF provider. On an organisation it is a
-- floor like every policy: G until the organisation allows PG-13.
ALTER TABLE workspaces ADD COLUMN gifs text NOT NULL DEFAULT 'g'
  CHECK (gifs IN ('off', 'g', 'pg-13'));

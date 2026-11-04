-- Owned by modules/figma. Only modules/figma/repo.ts writes this table.
-- The Figma plugin's sign-in to Freero (#172; docs/integrations/figma.md): Freero's own OAuth sends
-- the browser back to /api/integrations/figma/plugin/callback, which keeps the authorization code
-- here, sealed, under the hash of the plugin's state, for the plugin to pick up once within five
-- minutes. The code alone is worth nothing: redeeming it needs the PKCE verifier only the plugin holds.
CREATE TABLE figma_plugin_codes (
  state_hash text PRIMARY KEY,
  code       text NOT NULL,
  expires_at timestamptz NOT NULL
);

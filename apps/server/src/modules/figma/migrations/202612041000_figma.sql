-- Owned by modules/figma. Only modules/figma/repo.ts writes these tables.
-- Figma (#171, #172; docs/integrations/figma.md).

-- A person's Figma account, connected through the operator's Figma app ("Place from Figma"). Its
-- tokens are sealed with platform/secrets ('figma-token-v1'); disconnecting deletes the row.
CREATE TABLE figma_accounts (
  user_id       text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  figma_user_id text NOT NULL,
  handle        text NOT NULL,
  email         text,
  access_token  text NOT NULL,
  refresh_token text,
  expires_at    timestamptz,
  linked_at     timestamptz NOT NULL
);

-- "Connect Figma" consents in progress: single use, 10 minutes, the state stored as a hash and bound
-- to the account and to the browser that started it (an HttpOnly cookie), and where to go back to.
CREATE TABLE figma_oauth_flows (
  state_hash   text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  browser_hash text NOT NULL,
  return_path  text NOT NULL,
  expires_at   timestamptz NOT NULL
);

-- Figma files a person opened in the picker: the picker's "Recent files" (Figma's API has no list
-- of a person's recent files). The newest 20 are kept.
CREATE TABLE figma_recent_files (
  user_id   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  file_key  text NOT NULL,
  name      text NOT NULL,
  thumbnail text,
  used_at   timestamptz NOT NULL,
  PRIMARY KEY (user_id, file_key)
);

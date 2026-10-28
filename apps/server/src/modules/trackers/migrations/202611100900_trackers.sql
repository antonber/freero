-- Owned by modules/trackers. Only modules/trackers/repo.ts writes these tables.
--
-- Issue-tracker sync (KAI-153): connections to a tracker (a team's, set up by its admins, or one
-- person's own), the issues linked to board items (one issue ↔ many items) and what both sides
-- last agreed on, which the per-field merge compares against.

CREATE TABLE tracker_connections (
  id                    text PRIMARY KEY,
  -- A team's connection (its members use it) XOR one person's own.
  workspace_id          text REFERENCES workspaces (id) ON DELETE CASCADE,
  owner_id              text REFERENCES users (id) ON DELETE CASCADE,
  provider              text NOT NULL CHECK (provider IN ('jira', 'linear', 'github')),
  name                  text NOT NULL,
  -- The tracker's site people browse (issue links), and where API calls go (they differ for
  -- Jira Cloud through OAuth: api.atlassian.com/ex/jira/<cloud id>).
  site                  text NOT NULL,
  api_base              text NOT NULL,
  deployment            text CHECK (deployment IN ('cloud', 'datacenter')),
  auth                  text NOT NULL CHECK (auth IN ('oauth', 'token')),
  -- JSON credentials sealed with platform/secrets (purpose 'tracker-credentials-v1'); never sent
  -- back or logged. NULL once revoked (the owner signed out everywhere): it needs a new one.
  credentials_sealed    text,
  -- Verifies webhook deliveries (sealed, purpose 'tracker-webhook-secret-v1').
  webhook_secret_sealed text,
  inbound               text NOT NULL DEFAULT 'webhook' CHECK (inbound IN ('webhook', 'polling')),
  -- Defaults (project, issue type), what the last test found (account, estimate field).
  settings              jsonb NOT NULL DEFAULT '{}',
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'needs_auth')),
  last_error            text,
  -- The tracker asked us to slow down (429): no call before this.
  cooldown_until        timestamptz,
  polled_at             timestamptz,
  created_by            text,
  created_at            timestamptz NOT NULL,
  updated_at            timestamptz NOT NULL,
  CHECK ((workspace_id IS NULL) <> (owner_id IS NULL))
);
CREATE INDEX tracker_connections_workspace ON tracker_connections (workspace_id) WHERE workspace_id IS NOT NULL;
CREATE INDEX tracker_connections_owner ON tracker_connections (owner_id) WHERE owner_id IS NOT NULL;

CREATE TABLE tracker_links (
  id            text PRIMARY KEY,
  connection_id text NOT NULL REFERENCES tracker_connections (id) ON DELETE CASCADE,
  board_id      text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  -- The tracker's stable id, the key people read and the issue's page.
  external_id   text NOT NULL,
  external_key  text NOT NULL,
  external_url  text NOT NULL,
  -- Whose access writes the tracker's changes onto the board ("Jira for Maria"): the person who
  -- linked it. Sync pauses while they can't edit the board.
  created_by    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The app origin the issue's links back to the board use.
  app_origin    text NOT NULL,
  -- What both sides last agreed on, canonical per field: { board: {…}, tracker: {…} }.
  base          jsonb NOT NULL DEFAULT '{"board": {}, "tracker": {}}',
  -- Items whose link back the tracker holds (so a removed item's is removed there).
  backlinks     text[] NOT NULL DEFAULT '{}',
  state         text NOT NULL DEFAULT 'ok' CHECK (state IN ('ok', 'error', 'paused')),
  last_error    text,
  attempts      integer NOT NULL DEFAULT 0,
  retry_at      timestamptz,
  synced_at     timestamptz,
  created_at    timestamptz NOT NULL,
  UNIQUE (board_id, connection_id, external_id)
);
CREATE INDEX tracker_links_connection ON tracker_links (connection_id, external_id);
CREATE INDEX tracker_links_retry ON tracker_links (retry_at) WHERE retry_at IS NOT NULL;

-- The board items of a link, in order (the first one carries a cluster's title). An item is in at
-- most one link.
CREATE TABLE tracker_link_sources (
  link_id    text NOT NULL REFERENCES tracker_links (id) ON DELETE CASCADE,
  board_id   text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  element_id text NOT NULL,
  position   integer NOT NULL,
  PRIMARY KEY (link_id, element_id),
  UNIQUE (board_id, element_id)
);

-- OAuth consent in flight (Jira Cloud 3LO): single use, 10 minutes, bound to the browser that
-- started it (sha256 of an HttpOnly cookie).
CREATE TABLE tracker_oauth_flows (
  state_hash   text PRIMARY KEY,
  provider     text NOT NULL,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  workspace_id text REFERENCES workspaces (id) ON DELETE CASCADE,
  browser_hash text NOT NULL,
  name         text NOT NULL,
  expires_at   timestamptz NOT NULL
);

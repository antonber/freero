-- Owned by modules/trackers. Only modules/trackers/repo.ts writes these tables.
--
-- Asana (#120) and monday.com (#121) as trackers, and the webhooks Freero registers in them itself
-- (people can't paste an address there): one row per connection and project (an Asana project, a
-- monday.com board). The row's id is in the address the tracker posts to, next to a key made with
-- the connection's webhook secret; Asana's handshake issues the secret its deliveries are signed
-- with (kept sealed, purpose 'tracker-hook-secret-v1'), accepted only while the row is pending —
-- while Freero is registering it — and only once.

ALTER TABLE tracker_connections DROP CONSTRAINT IF EXISTS tracker_connections_provider_check;
ALTER TABLE tracker_connections ADD CONSTRAINT tracker_connections_provider_check CHECK (provider IN ('jira', 'linear', 'github', 'azure', 'asana', 'monday'));

CREATE TABLE tracker_webhooks (
  id            text PRIMARY KEY,
  connection_id text NOT NULL REFERENCES tracker_connections (id) ON DELETE CASCADE,
  project       text NOT NULL,
  -- The tracker's id(s) for it (monday.com: one per event, comma-separated); NULL until registered.
  external_id   text,
  secret_sealed text,
  state         text NOT NULL CHECK (state IN ('pending', 'active', 'failed')),
  last_error    text,
  -- The app origin the address was made with (a retry registers the same address).
  app_origin    text NOT NULL,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL,
  UNIQUE (connection_id, project)
);
CREATE INDEX tracker_webhooks_failed ON tracker_webhooks (updated_at) WHERE state = 'failed';

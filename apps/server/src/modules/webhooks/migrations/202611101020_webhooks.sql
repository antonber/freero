-- Workspace webhooks (KAI-105): endpoints a team workspace's admins register, and every delivery
-- of an event (modules/events) to them. The URL and the signing secret are sealed at rest
-- (platform/secrets; an incoming-webhook URL of a chat app is a credential in itself); admins see
-- a shortened form of the URL, and the secret only once.
CREATE TABLE webhook_endpoints (
  id                   text PRIMARY KEY,
  workspace_id         text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url_sealed           text NOT NULL,
  url_display          text NOT NULL,
  description          text NOT NULL DEFAULT '',
  events               text[] NOT NULL,
  format               text NOT NULL,
  secret_sealed        text NOT NULL,
  enabled              boolean NOT NULL DEFAULT true,
  -- Why Freero turned it off (failing deliveries), or NULL.
  disabled_reason      text,
  -- Failed attempts in a row (any delivery); reset by a success or by turning it back on.
  consecutive_failures integer NOT NULL DEFAULT 0,
  created_by           text REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL,
  updated_at           timestamptz NOT NULL,
  last_delivery_at     timestamptz
);
CREATE INDEX webhook_endpoints_workspace ON webhook_endpoints (workspace_id);

CREATE TABLE webhook_deliveries (
  id              text PRIMARY KEY,
  endpoint_id     text NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  -- The event (modules/events), or NULL for a test delivery.
  event_id        bigint,
  event_type      text NOT NULL,
  -- The exact body sent on every attempt (signed per attempt).
  body            text NOT NULL,
  status          text NOT NULL,
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  response_status integer,
  error           text,
  duration_ms     integer,
  created_at      timestamptz NOT NULL,
  delivered_at    timestamptz,
  -- One delivery per event and endpoint, however often the fan-out is replayed.
  UNIQUE (endpoint_id, event_id)
);
CREATE INDEX webhook_deliveries_due ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX webhook_deliveries_endpoint ON webhook_deliveries (endpoint_id, created_at DESC);
CREATE INDEX webhook_deliveries_created ON webhook_deliveries (created_at);

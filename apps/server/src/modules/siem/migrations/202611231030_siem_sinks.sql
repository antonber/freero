-- Owned by modules/siem. Only modules/siem/repo.ts writes this table.
--
-- #17: a team workspace's audit log streamed to its SIEM (Splunk HTTP Event Collector, Microsoft
-- Sentinel through the Logs Ingestion API, a generic HTTPS collector, or syslog over TLS). Each
-- sink reads the workspace's chain 'w:<id>' in seq order: `cursor_seq` is the newest event it
-- received (seqs are handed out under the chain head's row lock, so they commit in order and a
-- cursor never skips one still in flight). A failed batch is retried with backoff, never skipped.
-- Secrets (HEC token, client secret, bearer token, signing secret) are sealed (platform/secrets),
-- never sent back to a browser; `settings` holds only what isn't secret.
CREATE TABLE siem_sinks (
  id                   text PRIMARY KEY,
  workspace_id         text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind                 text NOT NULL CHECK (kind IN ('splunk', 'sentinel', 'https', 'syslog')),
  name                 text NOT NULL DEFAULT '',
  settings             jsonb NOT NULL,
  secrets_sealed       text NOT NULL,
  enabled              boolean NOT NULL DEFAULT true,
  cursor_seq           bigint NOT NULL DEFAULT 0,
  -- The newest head checkpoint (freero.audit.head) sent.
  anchored_seq         bigint NOT NULL DEFAULT 0,
  anchored_at          timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  next_attempt_at      timestamptz,
  last_error           text,
  last_attempt_at      timestamptz,
  last_delivered_at    timestamptz,
  created_by           text REFERENCES users (id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL,
  updated_at           timestamptz NOT NULL
);
CREATE INDEX siem_sinks_workspace ON siem_sinks (workspace_id);
CREATE INDEX siem_sinks_created_by ON siem_sinks (created_by);

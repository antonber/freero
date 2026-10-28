-- Owned by modules/audit. Only modules/audit/repo.ts writes these tables.
--
-- The audit log: append-only, hash-chained per CHAIN ('w:<workspaceId>' for a workspace's log,
-- 'u:<userId>' for an account's own events). No foreign keys on purpose: the log must outlive the
-- workspaces, boards and accounts it talks about (a deleted workspace's events age out with the
-- default retention).
CREATE TABLE audit_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain        text NOT NULL,
  seq          bigint NOT NULL,
  workspace_id text,
  actor_id     text,
  action       text NOT NULL,
  target_type  text,
  target_id    text,
  target_label text,
  ip           text,
  user_agent   text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL,
  prev_hash    text NOT NULL,
  hash         text NOT NULL,
  CONSTRAINT audit_events_chain_seq_key UNIQUE (chain, seq)
);
CREATE INDEX audit_events_workspace ON audit_events (workspace_id, id DESC) WHERE workspace_id IS NOT NULL;
CREATE INDEX audit_events_actor ON audit_events (actor_id, id DESC) WHERE actor_id IS NOT NULL;

-- The newest event of each chain (seq + hash): appending locks this row, so a chain's events get
-- consecutive numbers and each links to the one before, even with several instances writing.
-- pruned_seq / pruned_hash: the newest event retention removed (0 / genesis when none), so a
-- verification knows where the stored chain must start and what its first event links to.
CREATE TABLE audit_chains (
  chain       text PRIMARY KEY,
  seq         bigint NOT NULL,
  hash        text NOT NULL,
  pruned_seq  bigint NOT NULL DEFAULT 0,
  pruned_hash text NOT NULL
);

-- Append-only, enforced by the database too: no UPDATE, no TRUNCATE, and DELETE only from the
-- retention job, which sets freero.audit_prune for its own transaction (repo.pruneChain).
CREATE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('freero.audit_prune', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_events is append-only (%)', TG_OP;
END
$$;
CREATE TRIGGER audit_events_no_change BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();

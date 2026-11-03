-- #17: signed checkpoints of each chain's head. Someone with database write access could rewrite a
-- whole chain AND its audit_chains row consistently; they can't sign the rewritten head, because
-- `mac` is HMAC-SHA256 under the server's secret (platform/secrets, rotation-aware), which is not in
-- the database. A verification checks each anchor still in retention against the stored event at
-- its seq. The same heads are also posted to the workspace's SIEM streams (modules/siem), outside
-- this database altogether. Append-only like audit_events; retention removes the anchors of
-- pruned events only.
CREATE TABLE audit_anchors (
  chain       text NOT NULL,
  seq         bigint NOT NULL,
  hash        text NOT NULL,
  anchored_at timestamptz NOT NULL,
  mac         text NOT NULL,
  PRIMARY KEY (chain, seq)
);

CREATE FUNCTION audit_anchors_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('freero.audit_prune', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_anchors is append-only (%)', TG_OP;
END
$$;
CREATE TRIGGER audit_anchors_no_change BEFORE UPDATE OR DELETE ON audit_anchors
  FOR EACH ROW EXECUTE FUNCTION audit_anchors_append_only();
CREATE TRIGGER audit_anchors_no_truncate BEFORE TRUNCATE ON audit_anchors
  FOR EACH STATEMENT EXECUTE FUNCTION audit_anchors_append_only();

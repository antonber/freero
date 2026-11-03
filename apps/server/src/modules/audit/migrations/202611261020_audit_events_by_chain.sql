-- Owned by modules/audit. #108: a log is read by its chain ('w:<id>'), not by `workspace_id`: an
-- organisation's chain holds the events of all its workspaces, each row keeping the workspace it
-- happened in. For every existing 'w:<id>' row workspace_id = <id>, so reading by chain is the
-- same set as before.
CREATE INDEX audit_events_chain_id ON audit_events (chain, id DESC);

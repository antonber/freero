-- Owned by modules/trackers. Only modules/trackers/repo.ts writes this table.
--
-- Proposed imports (#82): an app that may only suggest (MCP import_from_tracker with read +
-- suggest) proposes issues as cards in one suggestion group; each row says which issue a proposed
-- card stands for. When an editor accepts the card (realtime reports the decision), the trackers
-- module links it to its issue exactly as an import would — written only here, from the server's
-- own record of what was proposed, so no socket can link an item to an issue.

CREATE TABLE tracker_proposals (
  board_id      text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  -- The proposed card's id (the id it gets when accepted) and its suggestion group.
  item_id       text NOT NULL,
  group_id      text NOT NULL,
  connection_id text NOT NULL REFERENCES tracker_connections (id) ON DELETE CASCADE,
  external_id   text NOT NULL,
  external_key  text NOT NULL,
  external_url  text NOT NULL,
  -- The person the app proposed it for: their access to the connection and the board links it.
  proposed_by   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  app_origin    text NOT NULL,
  created_at    timestamptz NOT NULL,
  -- The suggestion's decision as last reported (NULL: pending), and when the accepted card was linked.
  decision      text CHECK (decision IN ('accepted', 'rejected')),
  decided_by    text,
  decided_at    timestamptz,
  linked_at     timestamptz,
  PRIMARY KEY (board_id, item_id)
);
-- Accepted cards still to link (the outbox consumer looks them up per board).
CREATE INDEX tracker_proposals_to_link ON tracker_proposals (board_id) WHERE decision = 'accepted' AND linked_at IS NULL;
CREATE INDEX tracker_proposals_decided ON tracker_proposals (decided_at) WHERE decided_at IS NOT NULL;

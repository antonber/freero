-- Owned by modules/trackers. Only modules/trackers/repo.ts writes these tables.
--
-- Dependencies between linked issues (#50): one row per "blocker blocks blocked" pair both sides
-- last agreed on — a connector between the two links' cards on the board, the tracker's own
-- "blocks" link there. A pair that appears or goes on one side since is carried to the other by
-- the next sync of either link; a link removed takes its pairs with it.

CREATE TABLE tracker_relations (
  blocker_link text NOT NULL REFERENCES tracker_links (id) ON DELETE CASCADE,
  blocked_link text NOT NULL REFERENCES tracker_links (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL,
  PRIMARY KEY (blocker_link, blocked_link)
);
CREATE INDEX tracker_relations_blocked ON tracker_relations (blocked_link);

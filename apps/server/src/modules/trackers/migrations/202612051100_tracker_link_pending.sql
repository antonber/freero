-- Owned by modules/trackers. Only modules/trackers/repo.ts writes these tables.
--
-- A link can be 'pending': made by a request that hasn't finished — a send that reserved its items
-- before creating the issue (so a second send of them is refused instead of creating a duplicate),
-- or an import whose cards aren't on the board yet. Syncs, polls and retries leave a pending link
-- alone; the request makes it 'ok' (or removes it), and the poll job settles one whose request died.
-- Every existing row is 'ok', 'error' or 'paused', so this applies to any data.
ALTER TABLE tracker_links DROP CONSTRAINT IF EXISTS tracker_links_state_check;
ALTER TABLE tracker_links ADD CONSTRAINT tracker_links_state_check CHECK (state IN ('pending', 'ok', 'error', 'paused'));
CREATE INDEX tracker_links_pending ON tracker_links (created_at) WHERE state = 'pending';

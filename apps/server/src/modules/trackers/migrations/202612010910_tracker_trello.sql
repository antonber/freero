-- Owned by modules/trackers. Only modules/trackers/repo.ts writes these tables.
--
-- Trello as a tracker (#181). Its webhooks are Freero's own (tracker_webhooks, one per board);
-- with the API key's secret known, it is kept sealed in `secret_sealed` and every delivery's
-- X-Trello-Webhook signature is checked. A connection's settings hold the Trello username it was
-- tested as (`login`), which is how a person's own connection matches them to Trello members.

ALTER TABLE tracker_connections DROP CONSTRAINT IF EXISTS tracker_connections_provider_check;
ALTER TABLE tracker_connections ADD CONSTRAINT tracker_connections_provider_check CHECK (provider IN ('jira', 'linear', 'github', 'azure', 'asana', 'monday', 'clickup', 'trello'));

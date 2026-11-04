-- Owned by modules/trackers. Only modules/trackers/repo.ts writes these tables.
--
-- ClickUp as a tracker (#180). Its webhooks are Freero's own (tracker_webhooks, one per List):
-- ClickUp names the secret it signs deliveries with when it makes one, kept sealed in
-- `secret_sealed` like Asana's handshake secret.

ALTER TABLE tracker_connections DROP CONSTRAINT IF EXISTS tracker_connections_provider_check;
ALTER TABLE tracker_connections ADD CONSTRAINT tracker_connections_provider_check CHECK (provider IN ('jira', 'linear', 'github', 'azure', 'asana', 'monday', 'clickup'));

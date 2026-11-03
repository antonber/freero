-- Owned by modules/trackers. Only modules/trackers/repo.ts writes these tables.
--
-- Azure DevOps Boards as a tracker (#6). Its connections reuse `deployment`: 'cloud' for Azure
-- DevOps Services, 'datacenter' for Azure DevOps Server. The field map (#43) and sprint field
-- (#119) live in `settings` (jsonb), so they need no column.

ALTER TABLE tracker_connections DROP CONSTRAINT IF EXISTS tracker_connections_provider_check;
ALTER TABLE tracker_connections ADD CONSTRAINT tracker_connections_provider_check CHECK (provider IN ('jira', 'linear', 'github', 'azure'));

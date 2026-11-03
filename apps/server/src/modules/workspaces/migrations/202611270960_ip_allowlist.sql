-- Owned by modules/workspaces. #156: the networks (canonical CIDR ranges) a workspace's boards open
-- from; empty: anywhere. On an organisation's row it applies to every attached workspace as well.
ALTER TABLE workspaces ADD COLUMN ip_allowlist text[] NOT NULL DEFAULT '{}';

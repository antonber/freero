-- Owned by modules/workspaces. Security and retention settings of a team workspace (admin
-- console, KAI-47 / KAI-51) and deactivated members.
ALTER TABLE workspaces ADD COLUMN require_two_factor boolean NOT NULL DEFAULT false;
-- NULL: no workspace limit (Freero's own session lifetime applies; sessions never idle out).
ALTER TABLE workspaces ADD COLUMN session_max_hours integer CHECK (session_max_hours > 0);
ALTER TABLE workspaces ADD COLUMN session_idle_minutes integer CHECK (session_idle_minutes > 0);
ALTER TABLE workspaces ADD COLUMN trash_retention_days integer NOT NULL DEFAULT 30 CHECK (trash_retention_days > 0);
-- NULL: unnamed versions are kept (thinned out with age); else deleted after this many days.
ALTER TABLE workspaces ADD COLUMN version_retention_days integer CHECK (version_retention_days > 0);
ALTER TABLE workspaces ADD COLUMN audit_retention_days integer NOT NULL DEFAULT 365 CHECK (audit_retention_days > 0);
-- Policies that end sessions are looked up per member: find the workspaces that set one quickly.
CREATE INDEX workspaces_session_policy ON workspaces (id) WHERE session_max_hours IS NOT NULL OR session_idle_minutes IS NOT NULL;

-- A deactivated member keeps their role, boards and memberships but opens nothing in the workspace.
ALTER TABLE workspace_members ADD COLUMN deactivated_at timestamptz;

-- Owned by modules/admin. #65: one row per team workspace and UTC day, written by the daily usage
-- rollup (admin:usage-rollup; an upsert, so running twice on a day never double-counts). Counts
-- only — nothing per person. Goes with its workspace (cascade); older than USAGE_HISTORY_MAX_DAYS
-- is pruned by the job.
CREATE TABLE workspace_usage_daily (
  workspace_id    text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  day             date NOT NULL,
  active_7d       integer NOT NULL,
  active_30d      integer NOT NULL,
  boards_created  integer NOT NULL,
  docs_created    integer NOT NULL,
  members         integer NOT NULL,
  guests          integer NOT NULL,
  api_calls       jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at     timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, day)
);
CREATE INDEX workspace_usage_daily_day ON workspace_usage_daily (day);

-- Owned by modules/problems. Only modules/problems/repo.ts writes this table.
--
-- When each operator (an OPERATOR_EMAILS address) was last emailed that problem reports are
-- waiting: at most one such email per address per window (problems/alerts.ts). The row is claimed
-- with one conditional upsert, so two instances (or two reports at once) never both send.
CREATE TABLE problem_alerts (
  email   text PRIMARY KEY,
  sent_at timestamptz NOT NULL
);

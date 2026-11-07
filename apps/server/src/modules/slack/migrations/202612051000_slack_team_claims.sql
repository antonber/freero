-- Owned by modules/slack. Only modules/slack/repo.ts writes these tables.
-- The app's token in a Slack workspace is forgotten, and revoked with Slack, once nobody there is
-- linked (#193). Whether to revoke is decided under a per-workspace lock against the consents in
-- flight, so a consent racing the last person's Disconnect keeps a working token:

-- Set while Freero revokes the row's token with Slack. A consent that got that same token from
-- Slack meanwhile is refused (the person tries again) instead of keeping a token about to stop working.
ALTER TABLE slack_teams ADD COLUMN revoking_at timestamptz;

-- "Connect Slack" consents Slack has answered (naming the workspace) that aren't linked yet: while
-- one is in flight, the workspace's token is kept even when nobody there is linked.
CREATE TABLE slack_team_claims (
  claim_id   text PRIMARY KEY,
  team_id    text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX slack_team_claims_team ON slack_team_claims (team_id);

-- Owned by modules/slack. Only modules/slack/repo.ts writes these tables.
-- Personal Slack (#105; docs/integrations/slack.md): people who connected their Slack account to
-- their Freero account through the operator's Slack app.

-- Slack workspaces the app was installed in through "Connect Slack": its bot token there, sealed
-- with platform/secrets ('slack-bot-token-v1'). Without a row, SLACK_BOT_TOKEN is used.
CREATE TABLE slack_teams (
  team_id    text PRIMARY KEY,
  bot_token  text NOT NULL,
  updated_at timestamptz NOT NULL
);

-- One Slack account per Freero account, and one Freero account per Slack account (connecting it
-- again from another Freero account moves it). No token of the person's: the app's bot writes to
-- them in `dm_channel` (its direct message with them, from conversations.open).
CREATE TABLE slack_user_links (
  user_id       text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  team_id       text NOT NULL,
  team_name     text NOT NULL,
  slack_user_id text NOT NULL,
  slack_name    text NOT NULL,
  dm_channel    text NOT NULL,
  linked_at     timestamptz NOT NULL,
  CONSTRAINT slack_user_links_slack UNIQUE (team_id, slack_user_id)
);
CREATE INDEX slack_user_links_team ON slack_user_links (team_id);

-- "Connect Slack" consents in progress: single use, 10 minutes, the state stored as a hash and bound
-- to the account and to the browser that started it (an HttpOnly cookie).
CREATE TABLE slack_oauth_flows (
  state_hash   text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  browser_hash text NOT NULL,
  expires_at   timestamptz NOT NULL
);

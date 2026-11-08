-- Owned by modules/analytics. Only modules/analytics/repo.ts writes this table.
--
-- Accounts that turned analytics off ("Turn off analytics" while signed in, or a browser that sends
-- Global Privacy Control / Do Not Track while they are signed in): the server sends no product
-- event for them (PostHog, POSTHOG_KEY; ARCHITECTURE.md "Analytics"), whichever browser, app or
-- assistant acts for them. A row is removed only when they turn analytics back on. Deleting the
-- account deletes it.
CREATE TABLE analytics_opt_outs (
  user_id        text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  opted_out_at   timestamptz NOT NULL
);

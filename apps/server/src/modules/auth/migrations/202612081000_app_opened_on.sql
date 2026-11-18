-- Owned by modules/auth. Only modules/auth/repo.ts writes this table.
-- app_opened_on: the last UTC day the account opened the app (its startup session check, GET
-- /auth/session). Written only when the day changes, by one conditional UPDATE: the day's first
-- open is counted once (product analytics' app_opened) whichever instance or tab serves it.
-- Nullable without a default, so adding it rewrites no rows.
ALTER TABLE users ADD COLUMN IF NOT EXISTS app_opened_on date;

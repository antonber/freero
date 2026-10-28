-- Owned by modules/uploads. Files an operator removed (modules/moderation calls uploads' index):
--   removed_at      set: GET /uploads/<name> answers 410 Gone, for good (until restored). The row
--                   is a tombstone: the sweep never deletes it, and since it exists the sweep's
--                   adoption can never give the name a fresh row either.
--   quarantine_key  where the bytes are kept meanwhile, so a mistaken removal can be undone: a
--                   storage key that never matches an upload name ("removed.<random>.<name>"),
--                   so it is neither served nor adopted. NULL once purged (or if the file was
--                   already gone): then the removal can't be undone.
-- Removed files don't count toward their owner's quota.
ALTER TABLE uploads ADD COLUMN removed_at timestamptz;
ALTER TABLE uploads ADD COLUMN quarantine_key text;

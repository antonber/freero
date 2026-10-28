-- Owned by modules/boards. Moderation (modules/moderation acts through boards' index):
--   removed_at       an operator took the board down ("removed for review"): it is gone for
--                    everyone, like a trashed board (lists, access, sockets), but kept exactly as
--                    it was until an operator restores it. Its owner can't delete it meanwhile,
--                    and the trash purge skips it.
--   link_blocked_at  an operator turned its link sharing off: link access resolves as 'none' and
--                    the owner can't turn it back on. link_access keeps the owner's setting, so
--                    restoring brings the link back as it was.
ALTER TABLE boards ADD COLUMN removed_at timestamptz;
ALTER TABLE boards ADD COLUMN link_blocked_at timestamptz;

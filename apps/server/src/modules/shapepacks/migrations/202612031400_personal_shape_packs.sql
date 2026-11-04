-- Owned by modules/shapepacks. Only modules/shapepacks/repo.ts writes these tables.
--
-- A person's own shape library (#4): packs that belong to one account instead of a workspace, shown
-- to that person on every board they open and to nobody else. Exactly one of the two homes is set;
-- a personal pack goes with its account.
ALTER TABLE shape_packs ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE shape_packs ADD COLUMN owner_id text REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE shape_packs ADD CONSTRAINT shape_packs_one_home CHECK ((workspace_id IS NULL) <> (owner_id IS NULL));
CREATE INDEX shape_packs_owner_id ON shape_packs (owner_id, created_at);

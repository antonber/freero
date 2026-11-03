-- Owned by modules/boards.
-- Live embeds on other sites (#2): the owner lets other sites frame the board (/embed/b/:id). What
-- the embed shows still follows the board's sharing; off by default.
ALTER TABLE boards ADD COLUMN embeddable boolean NOT NULL DEFAULT false;

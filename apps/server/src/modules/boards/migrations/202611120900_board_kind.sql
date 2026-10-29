-- Owned by modules/boards. Only modules/boards/repo.ts writes this table.
--
-- Docs (KAI-162): a board row is a CONTAINER — workspace, project, owner, members, link sharing,
-- password and expiry, trash, stars, moderation — and `kind` says what its content is: 'board'
-- (the canvas) or 'doc' (a collaborative document). Every access rule lives on the container, so
-- a doc is shared, requested, trashed, transferred and taken down exactly like a board. Its Yjs
-- document is stored by modules/realtime under the same id, like a board's.
ALTER TABLE boards ADD COLUMN kind text NOT NULL DEFAULT 'board' CHECK (kind IN ('board', 'doc'));

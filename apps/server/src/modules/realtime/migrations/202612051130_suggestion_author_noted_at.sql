-- Owned by modules/realtime. Only modules/realtime/repo.ts writes this table.
-- When each suggestion-author hint was last noted (proposeSuggestions). The clean-up that forgets
-- authors with nothing pending works from a view of the board that can predate a proposal whose
-- hint was noted moments ago (another instance loading the board, a withdrawal running at the
-- same time), so it leaves hints noted within the last hour alone. Existing rows count as noted
-- now: at worst a revocation in the next hour visits a board with nothing of its author left.
ALTER TABLE board_suggestion_authors ADD COLUMN noted_at timestamptz NOT NULL DEFAULT now();

-- Owned by modules/walkthroughs. Only modules/walkthroughs/repo.ts writes these tables.
--
-- #127: a walkthrough's summary and chapters (written by its author or an editor, maybe from a
-- draft the board's AI made from the captions), and emoji reactions viewers leave at moments.
ALTER TABLE walkthroughs ADD COLUMN summary text;
-- WalkthroughChapter[] (@freero/shared walkthroughs.ts), checked before it is stored; NULL: none.
ALTER TABLE walkthroughs ADD COLUMN chapters jsonb;

-- An emoji at a moment. A reaction is a click, not something someone wrote: it goes with its
-- author's account (CASCADE), like their views.
CREATE TABLE walkthrough_reactions (
  id             text PRIMARY KEY,
  walkthrough_id text NOT NULL REFERENCES walkthroughs (id) ON DELETE CASCADE,
  author_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  at_ms          integer NOT NULL CHECK (at_ms >= 0),
  emoji          text NOT NULL,
  created_at     timestamptz NOT NULL
);
CREATE INDEX walkthrough_reactions_walkthrough ON walkthrough_reactions (walkthrough_id, at_ms);
CREATE INDEX walkthrough_reactions_author ON walkthrough_reactions (author_id);

-- Owned by modules/gallery. Only modules/gallery/repo.ts writes this table.
--
-- The community template gallery (#162): boards people submitted as public templates. `content` is
-- a cleaned copy of the board's shared content made when it was submitted (gallery/content.ts: no
-- comments, no hidden frames' contents, nobody's drafts, nobody's ids), never a link to the board,
-- so later edits of the board and its deletion don't touch it. `preview_svg` is drawn once from
-- that copy. Nothing is public until an operator approves it (status, decided by modules/moderation
-- through this module's decideGalleryTemplate); a submission goes with its submitter's account.
CREATE TABLE gallery_templates (
  id               text PRIMARY KEY,
  submitted_by     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source_board_id  text,
  status           text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'removed')),
  title            text NOT NULL,
  description      text NOT NULL,
  category         text NOT NULL,
  licence          text NOT NULL CHECK (licence IN ('cc-by-4.0', 'cc0-1.0')),
  author           text NOT NULL,
  items            integer NOT NULL,
  content          jsonb NOT NULL,
  preview_svg      text NOT NULL,
  status_note      text NOT NULL DEFAULT '',
  installs         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL,
  decided_at       timestamptz,
  published_at     timestamptz
);
CREATE INDEX gallery_templates_status ON gallery_templates (status, published_at DESC);
CREATE INDEX gallery_templates_submitter ON gallery_templates (submitted_by, created_at);

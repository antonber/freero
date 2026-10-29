-- Owned by modules/walkthroughs. Only modules/walkthroughs/repo.ts writes these tables.
--
-- Async walkthroughs over a board (KAI-133): the narrator's recording (an upload: media_url), the
-- timeline of where they looked and pointed (replayed over the LIVE board), captions, comments
-- pinned to moments, and who watched.
--
-- A recording is its author's voice (and maybe face): it goes with their account (CASCADE), and
-- the upload, then referenced by nothing, with the uploads sweep.
CREATE TABLE walkthroughs (
  id                text PRIMARY KEY,
  board_id          text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  author_id         text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title             text NOT NULL,
  media_url         text NOT NULL,
  media_kind        text NOT NULL CHECK (media_kind IN ('audio', 'video')),
  duration_ms       integer NOT NULL CHECK (duration_ms > 0),
  -- WalkthroughTimeline (@freero/shared walkthroughs.ts), checked before it is stored.
  timeline          jsonb NOT NULL,
  -- WalkthroughCue[], or NULL when there are no captions.
  transcript        jsonb,
  transcript_source text CHECK (transcript_source IN ('ai', 'manual')),
  created_at        timestamptz NOT NULL
);
CREATE INDEX walkthroughs_board ON walkthroughs (board_id, created_at DESC);
CREATE INDEX walkthroughs_author ON walkthroughs (author_id);
CREATE INDEX walkthroughs_media ON walkthroughs (media_url);

-- Who watched (each account once; visitors without an account are not counted).
CREATE TABLE walkthrough_views (
  walkthrough_id text NOT NULL REFERENCES walkthroughs (id) ON DELETE CASCADE,
  viewer_id      text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  viewed_at      timestamptz NOT NULL,
  PRIMARY KEY (walkthrough_id, viewer_id)
);
CREATE INDEX walkthrough_views_viewer ON walkthrough_views (viewer_id);

-- Comments pinned to a moment of a walkthrough. A deleted account's comments stay, unattributed.
CREATE TABLE walkthrough_comments (
  id             text PRIMARY KEY,
  walkthrough_id text NOT NULL REFERENCES walkthroughs (id) ON DELETE CASCADE,
  author_id      text REFERENCES users (id) ON DELETE SET NULL,
  at_ms          integer NOT NULL CHECK (at_ms >= 0),
  text           text NOT NULL,
  created_at     timestamptz NOT NULL
);
CREATE INDEX walkthrough_comments_walkthrough ON walkthrough_comments (walkthrough_id, at_ms);
CREATE INDEX walkthrough_comments_author ON walkthrough_comments (author_id) WHERE author_id IS NOT NULL;

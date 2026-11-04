-- Owned by modules/walkthroughs. Only modules/walkthroughs/repo.ts writes these tables.
--
-- Several presenters in one walkthrough (#128). The host's recording is the walkthrough itself; the
-- others each record their own voice, view and pointer and send it for the same session. A voice
-- may arrive before or after the host saves, so voices are kept by session, and the walkthrough
-- names its session. A voice is its author's voice (and maybe face): it goes with their account.
ALTER TABLE walkthroughs ADD COLUMN session_id text;
CREATE UNIQUE INDEX walkthroughs_session ON walkthroughs (session_id) WHERE session_id IS NOT NULL;

CREATE TABLE walkthrough_voices (
  id          text PRIMARY KEY,
  board_id    text NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  session_id  text NOT NULL,
  author_id   text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  media_url   text NOT NULL,
  media_kind  text NOT NULL CHECK (media_kind IN ('audio', 'video')),
  offset_ms   integer NOT NULL CHECK (offset_ms >= 0),
  duration_ms integer NOT NULL CHECK (duration_ms > 0),
  -- WalkthroughTimeline, checked before it is stored.
  timeline    jsonb NOT NULL,
  created_at  timestamptz NOT NULL
);
CREATE INDEX walkthrough_voices_session ON walkthrough_voices (board_id, session_id);
CREATE INDEX walkthrough_voices_author ON walkthrough_voices (author_id);
CREATE INDEX walkthrough_voices_media ON walkthrough_voices (media_url);

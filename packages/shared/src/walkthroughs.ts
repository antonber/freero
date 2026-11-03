// Async walkthroughs over a board (KAI-133). A walkthrough is NOT a screen video: it is the
// narrator's voice (and optionally their camera) plus a TIMELINE of where they looked on the board
// and where their pointer was. Playback re-renders the LIVE board at each moment (crisp at any
// size, as the viewer is allowed to see it now) with the recorded voice / camera bubble on top.
//
// The media is an ordinary upload (`/uploads/<name>`: quota, sweep, moderation removal); the
// timeline, title, transcript, comments and views live in modules/walkthroughs. The board doc
// carries only a summary per walkthrough in the server-written `walkthroughs` collection, so open
// boards list new recordings, view counts and comment counts live.
//
// REST (anyone who can open the board reads; editors record; commenters comment):
// GET    /api/boards/:id/walkthroughs                     -> { walkthroughs: WalkthroughSummary[] }
// POST   /api/boards/:id/walkthroughs                     body CreateWalkthroughRequest -> { walkthrough: Walkthrough }
// GET    /api/boards/:id/walkthroughs/:wid                -> { walkthrough: Walkthrough }
// PATCH  /api/boards/:id/walkthroughs/:wid                body { title } -> { walkthrough }   (its author, owners, editors)
// DELETE /api/boards/:id/walkthroughs/:wid                -> 204                              (its author, owners, editors)
// POST   /api/boards/:id/walkthroughs/:wid/views          -> { views }  (one per person)
// GET    /api/boards/:id/walkthroughs/:wid/comments       -> { comments: WalkthroughComment[] }
// POST   /api/boards/:id/walkthroughs/:wid/comments       body { atMs, text } -> { comment }  (commenters and up)
// DELETE /api/boards/:id/walkthroughs/:wid/comments/:cid  -> 204  (its author, owners, editors)
// PUT    /api/boards/:id/walkthroughs/:wid/transcript     body { cues } -> { walkthrough }   (captions typed by hand)
// POST   /api/boards/:id/walkthroughs/:wid/transcript     -> { walkthrough }  (transcribed by the board's AI provider, only when AI is on)
// GET    /api/boards/:id/walkthroughs/:wid/download       -> the recording as an attachment (downloads policy, audited)
// GET    /api/boards/:id/walkthroughs-captions            -> { available: boolean, reason?: string }  (AI captions for this person here?)
// [#127] Summary and chapters, and emoji reactions at moments:
// PUT    /api/boards/:id/walkthroughs/:wid/chapters       body WalkthroughChaptersInput -> { walkthrough }  (its author, owners, editors)
// POST   /api/boards/:id/walkthroughs/:wid/chapters/draft -> WalkthroughChaptersInput  (a draft from the captions by the board's AI
//        provider, saved nowhere: the author edits it and saves it with PUT; 403 ai_unavailable / 409 no captions)
// GET    /api/boards/:id/walkthroughs/:wid/reactions      -> { reactions: WalkthroughReaction[] }
// POST   /api/boards/:id/walkthroughs/:wid/reactions      body { atMs, emoji } -> { reaction }  (commenters and up, with an account)
// DELETE /api/boards/:id/walkthroughs/:wid/reactions/:rid -> 204  (its author, owners, editors)

/** Server-written board collection: walkthrough id -> WalkthroughSummary. */
export const WALKTHROUGHS_COLLECTION = 'walkthroughs';

export const MAX_WALKTHROUGH_TITLE = 120;
/** Longest recording (the recorder stops itself here). */
export const MAX_WALKTHROUGH_MS = 20 * 60 * 1000;
/** Most samples of each track a timeline keeps (the recorder thins to fit; the server refuses more). */
export const MAX_TIMELINE_SAMPLES = 24_000;
export const MAX_WALKTHROUGH_COMMENT = 2000;
export const MAX_TRANSCRIPT_CUES = 2000;
export const MAX_CUE_TEXT = 500;
export const MAX_WALKTHROUGH_CHAPTERS = 50;
export const MAX_CHAPTER_TITLE = 80;
export const MAX_WALKTHROUGH_SUMMARY = 2000;
/** The reactions a viewer can leave at a moment (#127). */
export const WALKTHROUGH_REACTIONS = ['👍', '❤️', '😂', '🎉', '🤔', '👀'] as const;
/** Most reactions one person leaves on one walkthrough. */
export const MAX_REACTIONS_PER_PERSON = 100;

/**
 * Where the narrator looked and pointed, by milliseconds since the recording started.
 * `view`: [t, x, y, w, h] — the world rectangle their screen showed (a viewer of any screen size
 * sees at least that). `pointer`: [t, x, y] in world coordinates, or [t] when the pointer left
 * the board. Both sorted by t.
 */
export interface WalkthroughTimeline {
  v: 1;
  view: Array<[number, number, number, number, number]>;
  pointer: Array<[number, number, number] | [number]>;
}

/** One caption: from `start` to `end` ms, what was said. */
export interface WalkthroughCue {
  start: number;
  end: number;
  text: string;
}

export interface WalkthroughSummary {
  id: string;
  title: string;
  /** Null once the author's account is gone (their recordings go with it: see ARCHITECTURE.md). */
  authorId: string | null;
  createdAt: number;
  durationMs: number;
  /** 'video': a camera bubble; 'audio': voice only. */
  media: 'audio' | 'video';
  /** People who watched it (each person once). */
  views: number;
  comments: number;
  /** Captions exist. */
  captions: boolean;
  /** [additive, #127] Emoji reactions at moments (open boards re-read them when it changes). */
  reactions?: number;
}

/** [additive, #127] A chapter: where it starts and what it is called. */
export interface WalkthroughChapter {
  atMs: number;
  title: string;
}

/** [additive, #127] What the author saves (and what an AI draft proposes). */
export interface WalkthroughChaptersInput {
  /** A few sentences on what the walkthrough covers ('' removes it). */
  summary: string;
  /** In time order; an empty list removes them. */
  chapters: WalkthroughChapter[];
}

/** [additive, #127] An emoji at a moment. Who left it isn't shown (only whether it is yours). */
export interface WalkthroughReaction {
  id: string;
  atMs: number;
  emoji: string;
  mine: boolean;
}

export interface Walkthrough extends WalkthroughSummary {
  boardId: string;
  author: { id: string; name: string } | null;
  /** The recording (`/uploads/<name>`). */
  mediaUrl: string;
  /** Freero's moderators removed the recording (it answers 410). */
  mediaRemoved: boolean;
  timeline: WalkthroughTimeline;
  transcript: WalkthroughCue[] | null;
  /** How the transcript was made. */
  transcriptSource: 'ai' | 'manual' | null;
  /** [additive, #127] What it covers, and its chapters (empty: none yet). */
  summary?: string | null;
  chapters?: WalkthroughChapter[];
  /** The reader has watched it before. */
  viewed: boolean;
}

export interface CreateWalkthroughRequest {
  title: string;
  /** An upload of the caller's own: video/* or audio/*. */
  mediaUrl: string;
  /** 'video' when the camera was on (the bubble shows it). */
  media: 'audio' | 'video';
  durationMs: number;
  timeline: WalkthroughTimeline;
}

/** A comment pinned to a moment of a walkthrough. Mentions are `<@userId>` tokens (MENTION_RE). */
export interface WalkthroughComment {
  id: string;
  author: { id: string; name: string } | null;
  atMs: number;
  text: string;
  createdAt: number;
}

/** "1:05" / "12:03" / "1:02:03". */
export function formatWalkthroughTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

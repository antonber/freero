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
// [#128] Several presenters in one recording. The host records as before and invites people on the
// board (presence); each who joins records their OWN voice, view and pointer in their own browser
// against the same server clock, and sends it as a voice of the session:
// POST   /api/boards/:id/walkthroughs/voices              body AddWalkthroughVoiceRequest -> 201 { ok: true }
//        (editors; their own upload). The host's POST /walkthroughs with the same `session` makes
//        the walkthrough; voices sent before or after it join it. Someone who leaves early sends
//        what they recorded; the recording goes on without them.

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
  /** [additive, #128] When this voice was talking: [start, end] ms, sorted, not overlapping. */
  speech?: Array<[number, number]>;
}

/** One caption: from `start` to `end` ms, what was said. */
export interface WalkthroughCue {
  start: number;
  end: number;
  text: string;
  /** [additive, #128] Who said it, in a recording with several presenters. */
  speaker?: string;
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
  /** [additive, #128] People who presented in it (1: the author alone). */
  presenters?: number;
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
  /** [additive, #128] The other presenters' voices, each on the walkthrough's clock from `offsetMs`. */
  voices?: WalkthroughVoice[];
}

/** [additive, #128] One more presenter in a walkthrough: their recording, view and pointer. */
export interface WalkthroughVoice {
  id: string;
  author: { id: string; name: string } | null;
  /** `/uploads/<name>` */
  mediaUrl: string;
  media: 'audio' | 'video';
  mediaRemoved: boolean;
  /** Where on the walkthrough's clock their recording starts. */
  offsetMs: number;
  durationMs: number;
  timeline: WalkthroughTimeline;
}

/** [#128] A presenter's recording sent for a session (their own upload: video/* or audio/*). */
export interface AddWalkthroughVoiceRequest {
  session: string;
  mediaUrl: string;
  media: 'audio' | 'video';
  offsetMs: number;
  durationMs: number;
  timeline: WalkthroughTimeline;
}

/** [#128] A recording session's id (made by the host's browser). */
export const WALKTHROUGH_SESSION_RE = /^[A-Za-z0-9_-]{8,40}$/;
/** [#128] Most voices one session keeps besides the host's (someone who rejoins adds one more). */
export const MAX_WALKTHROUGH_VOICES = 12;

export interface CreateWalkthroughRequest {
  title: string;
  /** An upload of the caller's own: video/* or audio/*. */
  mediaUrl: string;
  /** 'video' when the camera was on (the bubble shows it). */
  media: 'audio' | 'video';
  durationMs: number;
  timeline: WalkthroughTimeline;
  /** [additive, #128] The recording session others joined: their voices become part of it. */
  session?: string;
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

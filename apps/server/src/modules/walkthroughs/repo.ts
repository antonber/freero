// The only writer of `walkthroughs`, `walkthrough_views` and `walkthrough_comments` (KAI-133).
import type { WalkthroughCue, WalkthroughTimeline } from '@freero/shared';
import { one, query } from '../../platform/db';

export interface WalkthroughRow {
  id: string;
  boardId: string;
  authorId: string;
  title: string;
  mediaUrl: string;
  media: 'audio' | 'video';
  durationMs: number;
  timeline: WalkthroughTimeline;
  transcript: WalkthroughCue[] | null;
  transcriptSource: 'ai' | 'manual' | null;
  createdAt: number;
}

/** A row with its counts. */
export interface WalkthroughWithCounts extends WalkthroughRow {
  views: number;
  comments: number;
}

interface Raw {
  id: string;
  board_id: string;
  author_id: string;
  title: string;
  media_url: string;
  media_kind: 'audio' | 'video';
  duration_ms: number;
  timeline: WalkthroughTimeline | string;
  transcript: WalkthroughCue[] | string | null;
  transcript_source: 'ai' | 'manual' | null;
  created_at: Date;
  views?: number | string;
  comments?: number | string;
}

const json = <T>(v: T | string): T => (typeof v === 'string' ? (JSON.parse(v) as T) : v);
const toRow = (r: Raw): WalkthroughWithCounts => ({
  id: r.id,
  boardId: r.board_id,
  authorId: r.author_id,
  title: r.title,
  mediaUrl: r.media_url,
  media: r.media_kind,
  durationMs: Number(r.duration_ms),
  timeline: json(r.timeline),
  transcript: r.transcript === null ? null : json(r.transcript),
  transcriptSource: r.transcript_source,
  createdAt: new Date(r.created_at).getTime(),
  views: Number(r.views ?? 0),
  comments: Number(r.comments ?? 0),
});

const SELECT = `SELECT w.*,
  (SELECT count(*) FROM walkthrough_views v WHERE v.walkthrough_id = w.id) AS views,
  (SELECT count(*) FROM walkthrough_comments c WHERE c.walkthrough_id = w.id) AS comments
  FROM walkthroughs w`;

export async function insert(w: WalkthroughRow): Promise<void> {
  await query(
    `INSERT INTO walkthroughs (id, board_id, author_id, title, media_url, media_kind, duration_ms, timeline, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [w.id, w.boardId, w.authorId, w.title, w.mediaUrl, w.media, w.durationMs, JSON.stringify(w.timeline), new Date(w.createdAt)],
  );
}

/** One walkthrough of the board (null: none, or another board's). */
export async function get(boardId: string, id: string): Promise<WalkthroughWithCounts | null> {
  const r = await one<Raw>(`${SELECT} WHERE w.board_id = $1 AND w.id = $2`, [boardId, id]);
  return r ? toRow(r) : null;
}

export async function getMany(ids: readonly string[]): Promise<WalkthroughWithCounts[]> {
  if (!ids.length) return [];
  return (await query<Raw>(`${SELECT} WHERE w.id = ANY($1::text[])`, [ids])).map(toRow);
}

/** The board's walkthroughs, newest first. */
export async function ofBoard(boardId: string): Promise<WalkthroughWithCounts[]> {
  return (await query<Raw>(`${SELECT} WHERE w.board_id = $1 ORDER BY w.created_at DESC, w.id`, [boardId])).map(toRow);
}

export async function rename(boardId: string, id: string, title: string): Promise<boolean> {
  return (await query(`UPDATE walkthroughs SET title = $3 WHERE board_id = $1 AND id = $2 RETURNING id`, [boardId, id, title])).length > 0;
}

export async function setTranscript(boardId: string, id: string, cues: WalkthroughCue[] | null, source: 'ai' | 'manual' | null): Promise<boolean> {
  return (
    (
      await query(`UPDATE walkthroughs SET transcript = $3, transcript_source = $4 WHERE board_id = $1 AND id = $2 RETURNING id`, [
        boardId,
        id,
        cues === null ? null : JSON.stringify(cues),
        cues === null ? null : source,
      ])
    ).length > 0
  );
}

export async function remove(boardId: string, id: string): Promise<boolean> {
  return (await query(`DELETE FROM walkthroughs WHERE board_id = $1 AND id = $2 RETURNING id`, [boardId, id])).length > 0;
}

/** Records that the person watched it; true the first time. */
export async function addView(id: string, viewerId: string, at: number): Promise<boolean> {
  return (
    (
      await query(`INSERT INTO walkthrough_views (walkthrough_id, viewer_id, viewed_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING viewer_id`, [
        id,
        viewerId,
        new Date(at),
      ])
    ).length > 0
  );
}

export async function hasViewed(id: string, viewerId: string): Promise<boolean> {
  return (await one(`SELECT 1 FROM walkthrough_views WHERE walkthrough_id = $1 AND viewer_id = $2`, [id, viewerId])) !== null;
}

// ---- comments ----

export interface CommentRow {
  id: string;
  walkthroughId: string;
  authorId: string | null;
  atMs: number;
  text: string;
  createdAt: number;
}

interface RawComment {
  id: string;
  walkthrough_id: string;
  author_id: string | null;
  at_ms: number;
  text: string;
  created_at: Date;
}
const toComment = (r: RawComment): CommentRow => ({
  id: r.id,
  walkthroughId: r.walkthrough_id,
  authorId: r.author_id,
  atMs: Number(r.at_ms),
  text: r.text,
  createdAt: new Date(r.created_at).getTime(),
});

export async function insertComment(c: CommentRow): Promise<void> {
  await query(`INSERT INTO walkthrough_comments (id, walkthrough_id, author_id, at_ms, text, created_at) VALUES ($1, $2, $3, $4, $5, $6)`, [
    c.id,
    c.walkthroughId,
    c.authorId,
    c.atMs,
    c.text,
    new Date(c.createdAt),
  ]);
}

/** A walkthrough's comments by moment, then when written. */
export async function comments(walkthroughId: string): Promise<CommentRow[]> {
  return (await query<RawComment>(`SELECT * FROM walkthrough_comments WHERE walkthrough_id = $1 ORDER BY at_ms, created_at, id`, [walkthroughId])).map(toComment);
}

export async function getComment(walkthroughId: string, id: string): Promise<CommentRow | null> {
  const r = await one<RawComment>(`SELECT * FROM walkthrough_comments WHERE walkthrough_id = $1 AND id = $2`, [walkthroughId, id]);
  return r ? toComment(r) : null;
}

export async function removeComment(walkthroughId: string, id: string): Promise<boolean> {
  return (await query(`DELETE FROM walkthrough_comments WHERE walkthrough_id = $1 AND id = $2 RETURNING id`, [walkthroughId, id])).length > 0;
}

// ---- data the account owns (export) and uploads they keep ----

export async function authoredBy(userId: string): Promise<WalkthroughWithCounts[]> {
  return (await query<Raw>(`${SELECT} WHERE w.author_id = $1 ORDER BY w.created_at`, [userId])).map(toRow);
}

export async function commentsBy(userId: string): Promise<Array<CommentRow & { boardId: string; title: string }>> {
  const rows = await query<RawComment & { board_id: string; title: string }>(
    `SELECT c.*, w.board_id, w.title FROM walkthrough_comments c JOIN walkthroughs w ON w.id = c.walkthrough_id WHERE c.author_id = $1 ORDER BY c.created_at`,
    [userId],
  );
  return rows.map((r) => ({ ...toComment(r), boardId: r.board_id, title: r.title }));
}

export async function viewsBy(userId: string): Promise<Array<{ walkthroughId: string; viewedAt: number }>> {
  const rows = await query<{ walkthrough_id: string; viewed_at: Date }>(`SELECT walkthrough_id, viewed_at FROM walkthrough_views WHERE viewer_id = $1 ORDER BY viewed_at`, [
    userId,
  ]);
  return rows.map((r) => ({ walkthroughId: r.walkthrough_id, viewedAt: new Date(r.viewed_at).getTime() }));
}

/** Recordings' upload URLs (all, or those among `urls`): the uploads sweep keeps these files. */
export async function mediaUrls(urls: readonly string[] | null): Promise<string[]> {
  const rows = urls
    ? await query<{ media_url: string }>(`SELECT DISTINCT media_url FROM walkthroughs WHERE media_url = ANY($1::text[])`, [urls])
    : await query<{ media_url: string }>(`SELECT DISTINCT media_url FROM walkthroughs`);
  return rows.map((r) => r.media_url);
}

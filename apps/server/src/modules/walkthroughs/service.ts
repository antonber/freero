// Async walkthroughs over a board (KAI-133; contract: @freero/shared walkthroughs.ts).
//
// Who: anyone who may open the board watches (guests too) — a walkthrough shows the LIVE board as
// each viewer may see it, so it reveals no item the viewer couldn't see anyway. Editors and owners
// record; commenters and up comment; the author, editors and owners rename, caption and delete.
//
// The recording is an upload of the author's own (quota, sweep, moderation removal); this module
// keeps it referenced (walkthroughUploadReferences) until the walkthrough is deleted — with the
// board, or with the author's account: a recording is their voice and maybe face.
//
// Open boards learn about changes through the server-written `walkthroughs` collection (one
// summary per walkthrough: title, length, counts), never the timeline or the media URL.
import {
  isGuestId,
  MAX_CUE_TEXT,
  MAX_TIMELINE_SAMPLES,
  MAX_TRANSCRIPT_CUES,
  MAX_WALKTHROUGH_COMMENT,
  MAX_WALKTHROUGH_MS,
  MAX_WALKTHROUGH_TITLE,
  mentionedUserIds,
  mentionsAsNames,
  WALKTHROUGHS_COLLECTION,
  type Role,
  type Walkthrough,
  type WalkthroughComment,
  type WalkthroughCue,
  type WalkthroughSummary,
  type WalkthroughTimeline,
} from '@freero/shared';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { logError } from '../../platform/log';
import { transcribeRecording, transcriptionUnavailable } from '../ai/index';
import { recordAuditQuietly } from '../audit/index';
import { getUsers } from '../auth/index';
import { authorizeFileDownload, requireBoardAccess } from '../boards/index';
import { atLeast } from '../members/index';
import { notify } from '../notifications/index';
import { writeServerCollection } from '../realtime/index';
import { openUploadForDownload, readUpload, uploadInfo, uploadName } from '../uploads/index';
import * as repo from './repo';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const COORD = 1e8;

// ---- shapes ----

const summaryOf = (w: repo.WalkthroughWithCounts): WalkthroughSummary => ({
  id: w.id,
  title: w.title,
  authorId: w.authorId,
  createdAt: w.createdAt,
  durationMs: w.durationMs,
  media: w.media,
  views: w.views,
  comments: w.comments,
  captions: !!w.transcript?.length,
});

/** Tells every open copy of the board (live, every instance). Never fails the request that changed it. */
async function publish(boardId: string, id: string): Promise<void> {
  try {
    const w = await repo.get(boardId, id);
    await writeServerCollection(boardId, WALKTHROUGHS_COLLECTION, { [id]: w ? summaryOf(w) : null });
  } catch (e) {
    logError('walkthroughs: could not update the board’s list', e);
  }
}

async function nameMap(ids: Array<string | null>): Promise<Map<string, { id: string; name: string }>> {
  const users = await getUsers(ids.filter((x): x is string => !!x));
  return new Map([...users.values()].map((u) => [u.id, { id: u.id, name: u.name }]));
}

// ---- checking what clients send ----

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function cleanTitle(v: unknown): string {
  if (typeof v !== 'string') throw badRequest('title must be text');
  const t = v.replace(/\s+/g, ' ').trim().slice(0, MAX_WALKTHROUGH_TITLE);
  if (!t) throw badRequest('Give the walkthrough a title');
  return t;
}

/**
 * The timeline as stored: every sample numeric and in range, at most MAX_TIMELINE_SAMPLES per track,
 * sorted by time, times within the recording. Anything else is refused (400), never repaired into
 * something the narrator didn't record.
 */
export function cleanTimeline(raw: unknown, durationMs: number): WalkthroughTimeline {
  const t = raw as Partial<WalkthroughTimeline> | null;
  if (!t || typeof t !== 'object' || t.v !== 1 || !Array.isArray(t.view) || !Array.isArray(t.pointer)) throw badRequest('timeline must be { v: 1, view: [], pointer: [] }');
  if (t.view.length > MAX_TIMELINE_SAMPLES || t.pointer.length > MAX_TIMELINE_SAMPLES) throw badRequest(`A timeline keeps at most ${MAX_TIMELINE_SAMPLES} samples per track`);
  const inTime = (ms: unknown): ms is number => finite(ms) && ms >= 0 && ms <= durationMs + 5000;
  const inWorld = (n: unknown): n is number => finite(n) && Math.abs(n) <= COORD;
  const view: WalkthroughTimeline['view'] = [];
  for (const s of t.view) {
    if (!Array.isArray(s) || s.length !== 5 || !inTime(s[0]) || !s.slice(1).every(inWorld) || !(s[3] > 0) || !(s[4] > 0)) throw badRequest('Bad view sample in the timeline');
    view.push([s[0], s[1], s[2], s[3], s[4]]);
  }
  const pointer: WalkthroughTimeline['pointer'] = [];
  for (const s of t.pointer) {
    if (!Array.isArray(s) || !inTime(s[0])) throw badRequest('Bad pointer sample in the timeline');
    if (s.length === 1) pointer.push([s[0]]);
    else if (s.length === 3 && inWorld(s[1]) && inWorld(s[2])) pointer.push([s[0], s[1], s[2]]);
    else throw badRequest('Bad pointer sample in the timeline');
  }
  if (!view.length) throw badRequest('The timeline has no view of the board');
  view.sort((a, b) => a[0] - b[0]);
  pointer.sort((a, b) => a[0] - b[0]);
  return { v: 1, view, pointer };
}

/** Captions as stored: in time order, within the recording, short texts. */
export function cleanCues(raw: unknown, durationMs: number): WalkthroughCue[] {
  if (!Array.isArray(raw) || raw.length > MAX_TRANSCRIPT_CUES) throw badRequest(`cues must be a list of at most ${MAX_TRANSCRIPT_CUES} captions`);
  const out: WalkthroughCue[] = [];
  for (const c of raw as Array<Partial<WalkthroughCue>>) {
    if (!c || !finite(c.start) || !finite(c.end) || typeof c.text !== 'string') throw badRequest('Each caption is { start, end, text }');
    const start = Math.max(0, Math.round(c.start));
    const end = Math.min(durationMs, Math.round(c.end));
    const text = c.text.replace(/\s+/g, ' ').trim().slice(0, MAX_CUE_TEXT);
    if (text && end > start) out.push({ start, end, text });
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---- access ----

async function boardFor(boardId: string, actorId: string, min: Role = 'viewer') {
  return requireBoardAccess(boardId, actorId, min);
}

async function found(boardId: string, id: string): Promise<repo.WalkthroughWithCounts> {
  const w = ID.test(id) ? await repo.get(boardId, id) : null;
  if (!w) throw notFound('Walkthrough not found');
  return w;
}

/** The author (while they can still open the board), owners and editors. */
async function requireManage(boardId: string, w: repo.WalkthroughRow, userId: string) {
  const board = await boardFor(boardId, userId);
  if (w.authorId !== userId && !atLeast(board.role, 'editor')) throw forbidden('Only its author and the board’s editors can change this walkthrough');
  return board;
}

// ---- walkthroughs ----

export async function createWalkthrough(boardId: string, userId: string, body: unknown): Promise<Walkthrough> {
  const b = (body ?? {}) as Record<string, unknown>;
  const board = await boardFor(boardId, userId, 'editor');
  const title = cleanTitle(b.title);
  if (!finite(b.durationMs) || b.durationMs <= 0 || b.durationMs > MAX_WALKTHROUGH_MS + 5000) throw badRequest(`durationMs must be the recording’s length (at most ${MAX_WALKTHROUGH_MS / 60000} minutes)`);
  const durationMs = Math.round(b.durationMs);
  const timeline = cleanTimeline(b.timeline, durationMs);
  const name = typeof b.mediaUrl === 'string' && b.mediaUrl.startsWith('/uploads/') ? uploadName(b.mediaUrl) : null;
  const info = name ? await uploadInfo(name) : null;
  // The caller's own recording, stored as video or audio (the bytes decided), not removed.
  if (!name || !info || info.ownerId !== userId || !/^(video|audio)\//.test(info.contentType)) throw badRequest('mediaUrl must be a video or audio file you uploaded');
  if (info.removed) throw new HttpError(410, 'This file was removed by Freero’s moderators');
  const media = b.media === 'video' ? 'video' : b.media === 'audio' ? 'audio' : info.contentType.startsWith('audio/') ? 'audio' : 'video';
  const row: repo.WalkthroughRow = {
    id: newId(12),
    boardId,
    authorId: userId,
    title,
    mediaUrl: `/uploads/${name}`,
    media,
    durationMs,
    timeline,
    transcript: null,
    transcriptSource: null,
    createdAt: Date.now(),
  };
  await repo.insert(row);
  await recordAuditQuietly({
    action: 'walkthrough.created',
    actorId: userId,
    workspaceId: board.workspaceId,
    target: { type: 'board', id: boardId, label: board.title },
    metadata: { walkthrough: row.id, title, durationMs },
  });
  await publish(boardId, row.id);
  return getWalkthrough(boardId, row.id, userId);
}

export async function listWalkthroughs(boardId: string, actorId: string): Promise<WalkthroughSummary[]> {
  await boardFor(boardId, actorId);
  return (await repo.ofBoard(boardId)).map(summaryOf);
}

export async function getWalkthrough(boardId: string, id: string, actorId: string): Promise<Walkthrough> {
  await boardFor(boardId, actorId);
  const w = await found(boardId, id);
  const [names, viewed, info] = await Promise.all([
    nameMap([w.authorId]),
    isGuestId(actorId) ? Promise.resolve(false) : repo.hasViewed(w.id, actorId),
    uploadInfo(uploadName(w.mediaUrl) ?? ''),
  ]);
  return {
    ...summaryOf(w),
    boardId,
    author: names.get(w.authorId) ?? null,
    mediaUrl: w.mediaUrl,
    mediaRemoved: info?.removed ?? false,
    timeline: w.timeline,
    transcript: w.transcript,
    transcriptSource: w.transcriptSource,
    viewed,
  };
}

export async function renameWalkthrough(boardId: string, id: string, userId: string, body: unknown): Promise<Walkthrough> {
  const w = await found(boardId, id);
  await requireManage(boardId, w, userId);
  await repo.rename(boardId, id, cleanTitle((body as { title?: unknown } | null)?.title));
  await publish(boardId, id);
  return getWalkthrough(boardId, id, userId);
}

export async function deleteWalkthrough(boardId: string, id: string, userId: string): Promise<void> {
  const w = await found(boardId, id);
  const board = await requireManage(boardId, w, userId);
  if (!(await repo.remove(boardId, id))) return;
  await recordAuditQuietly({
    action: 'walkthrough.deleted',
    actorId: userId,
    workspaceId: board.workspaceId,
    target: { type: 'board', id: boardId, label: board.title },
    metadata: { walkthrough: id, title: w.title },
  });
  // The recording is now referenced by nothing: the uploads sweep deletes it after its grace period.
  await publish(boardId, id);
}

/** Counts the person once; visitors without an account watch uncounted. Returns the count. */
export async function recordView(boardId: string, id: string, actorId: string): Promise<number> {
  await boardFor(boardId, actorId);
  const w = await found(boardId, id);
  if (isGuestId(actorId) || w.authorId === actorId) return w.views;
  if (await repo.addView(id, actorId, Date.now())) {
    await publish(boardId, id);
    return w.views + 1;
  }
  return w.views;
}

// ---- comments at moments ----

async function toComments(rows: repo.CommentRow[]): Promise<WalkthroughComment[]> {
  const names = await nameMap(rows.map((r) => r.authorId));
  return rows.map((r) => ({ id: r.id, author: r.authorId ? (names.get(r.authorId) ?? null) : null, atMs: r.atMs, text: r.text, createdAt: r.createdAt }));
}

export async function listComments(boardId: string, id: string, actorId: string): Promise<WalkthroughComment[]> {
  await boardFor(boardId, actorId);
  const w = await found(boardId, id);
  return toComments(await repo.comments(w.id));
}

/**
 * A comment at `atMs`. @mentioned people who can open the board are notified (a mention), and the
 * author of the walkthrough hears about comments on it — one notification per person per comment.
 */
export async function addComment(boardId: string, id: string, userId: string, body: unknown): Promise<WalkthroughComment> {
  const board = await boardFor(boardId, userId, 'commenter');
  const w = await found(boardId, id);
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.text !== 'string' || !b.text.trim()) throw badRequest('Write something');
  const text = b.text.trim().slice(0, MAX_WALKTHROUGH_COMMENT);
  if (!finite(b.atMs) || b.atMs < 0) throw badRequest('atMs must be a moment of the recording');
  const atMs = Math.min(Math.round(b.atMs), w.durationMs);
  const row: repo.CommentRow = { id: newId(12), walkthroughId: w.id, authorId: userId, atMs, text, createdAt: Date.now() };
  await repo.insertComment(row);
  await publish(boardId, id);

  const mentioned = mentionedUserIds(text).filter((m) => m !== userId);
  const names = await nameMap(mentioned);
  const data = {
    boardTitle: board.title,
    walkthroughId: w.id,
    walkthroughTitle: w.title,
    atMs,
    excerpt: mentionsAsNames(text, (u) => names.get(u)?.name).replace(/\s+/g, ' ').slice(0, 280),
  };
  const told = new Set<string>();
  for (const person of mentioned) {
    try {
      // notify() checks the person can open the board: a mention never reaches anyone else.
      if (await notify({ userId: person, type: 'walkthrough.mention', actorId: userId, boardId, data, dedupeKey: `walkthrough:${row.id}` })) told.add(person);
    } catch (e) {
      logError('walkthroughs: a mention notification failed', e);
    }
  }
  if (w.authorId !== userId && !told.has(w.authorId)) {
    try {
      await notify({ userId: w.authorId, type: 'walkthrough.comment', actorId: userId, boardId, data, dedupeKey: `walkthrough:${row.id}` });
    } catch (e) {
      logError('walkthroughs: a comment notification failed', e);
    }
  }
  return (await toComments([row]))[0];
}

export async function deleteComment(boardId: string, id: string, commentId: string, userId: string): Promise<void> {
  const board = await boardFor(boardId, userId);
  const w = await found(boardId, id);
  const c = ID.test(commentId) ? await repo.getComment(w.id, commentId) : null;
  if (!c) throw notFound('Comment not found');
  if (c.authorId !== userId && !atLeast(board.role, 'editor')) throw forbidden('Only its author and the board’s editors can delete this comment');
  await repo.removeComment(w.id, commentId);
  await publish(boardId, id);
}

// ---- captions ----

/** Captions typed (or pasted) by the author or an editor; an empty list removes them. */
export async function setCaptions(boardId: string, id: string, userId: string, body: unknown): Promise<Walkthrough> {
  const w = await found(boardId, id);
  await requireManage(boardId, w, userId);
  const cues = cleanCues((body as { cues?: unknown } | null)?.cues, w.durationMs);
  await repo.setTranscript(boardId, id, cues.length ? cues : null, 'manual');
  await publish(boardId, id);
  return getWalkthrough(boardId, id, userId);
}

/** Why AI captions can't be made here by this person (null: they can). */
export async function captionsUnavailable(boardId: string, userId: string): Promise<string | null> {
  if (isGuestId(userId)) return 'AI needs a Freero account.';
  return transcriptionUnavailable(boardId, userId).catch((e: unknown) => (e instanceof HttpError && e.status === 404 ? 'AI isn’t set up on this Freero server.' : Promise.reject(e)));
}

/** Captions from the board's AI provider (only when AI is on for this person on this board). */
export async function transcribeWalkthrough(boardId: string, id: string, userId: string): Promise<Walkthrough> {
  const w = await found(boardId, id);
  const board = await requireManage(boardId, w, userId);
  const bytes = await readUpload(w.mediaUrl);
  if (!bytes) throw notFound('The recording is gone');
  const info = await uploadInfo(uploadName(w.mediaUrl) ?? '');
  if (info?.removed) throw new HttpError(410, 'This file was removed by Freero’s moderators');
  const ext = w.mediaUrl.split('.').pop() ?? 'webm';
  const cues = await transcribeRecording(boardId, userId, { bytes, contentType: info?.contentType ?? 'application/octet-stream', fileName: `walkthrough.${ext}` }, w.durationMs);
  await repo.setTranscript(boardId, id, cues, 'ai');
  await recordAuditQuietly({
    action: 'walkthrough.transcribed',
    actorId: userId,
    workspaceId: board.workspaceId,
    target: { type: 'board', id: boardId, label: board.title },
    metadata: { walkthrough: id },
  });
  await publish(boardId, id);
  return getWalkthrough(boardId, id, userId);
}

// ---- download (the workspace's downloads policy, audited like a file from the board) ----

export async function openWalkthroughDownload(boardId: string, id: string, actorId: string) {
  const { record } = await authorizeFileDownload(boardId, actorId);
  const w = await found(boardId, id);
  const name = uploadName(w.mediaUrl);
  if (!name) throw notFound('The recording is gone');
  const file = await openUploadForDownload(name);
  const fileName = `${w.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'walkthrough'}.${name.split('.').pop()}`;
  try {
    await record({ name: fileName.slice(0, 200), upload: name });
  } catch (e) {
    file.body.destroy(); // nothing leaves without its audit record
    throw e;
  }
  return { ...file, name: fileName };
}

// ---- for other modules ----

/** Recordings the uploads sweep must keep (all, or those among `among`, by upload name). */
export async function walkthroughUploadReferences(among?: readonly string[]): Promise<string[]> {
  const urls = await repo.mediaUrls(among ? among.map((n) => `/uploads/${n}`) : null);
  return urls.map((u) => uploadName(u)).filter((n): n is string => !!n);
}

/** A person's walkthroughs, comments and views (their data export; recordings are in their uploads). */
export async function walkthroughsExportOf(userId: string) {
  const [made, comments, views] = await Promise.all([repo.authoredBy(userId), repo.commentsBy(userId), repo.viewsBy(userId)]);
  return {
    walkthroughs: made.map((w) => ({
      id: w.id,
      boardId: w.boardId,
      title: w.title,
      recording: w.mediaUrl,
      durationMs: w.durationMs,
      createdAt: new Date(w.createdAt).toISOString(),
      timeline: w.timeline,
      transcript: w.transcript,
    })),
    comments: comments.map((c) => ({ walkthroughId: c.walkthroughId, walkthroughTitle: c.title, boardId: c.boardId, atMs: c.atMs, text: c.text, createdAt: new Date(c.createdAt).toISOString() })),
    watched: views.map((v) => ({ walkthroughId: v.walkthroughId, at: new Date(v.viewedAt).toISOString() })),
  };
}

/** Summaries for the object registry. */
export const walkthroughsByIds = (ids: readonly string[]) => repo.getMany(ids);

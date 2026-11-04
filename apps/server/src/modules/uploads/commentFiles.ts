// Files and images on comments (#143): GET /api/boards/:id/comment-files/:threadId/:messageId/:index.
// The one way such a file is ever served. The message is looked up in the board AS THE PERSON
// SEES IT (realtime's view: a thread inside a hidden frame or on someone's private draft isn't
// theirs), so nobody who can't open the board — or can't read that message there — gets its files,
// and the request can't name a file another board holds: the reference comes from the message, it
// must be an attachment upload, and it must be its author's own upload (a message can't point at
// someone else's file and launder it out). Downloading a file is an export (downloads policy,
// audited, like a file card); showing an image inline is reading the board (any role), and only
// when its bytes are a raster image.
import type { Readable } from 'node:stream';
import type { CommentAttachment, CommentMessageRecord } from '@freero/shared';
import { HttpError, notFound } from '../../platform/http';
import { authorizeFileDownload, requireBoardAccess } from '../boards/index';
import { readBoardView } from '../realtime/index';
import * as repo from './repo';
import { isUploadRemoved, uploadName } from './moderation';
import { openUpload } from './sealedFiles';
import { ATTACHMENT_EXT, contentMatches } from './store';

const INLINE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export interface CommentFile {
  body: Readable;
  size: number | null;
  name: string;
  /** Set when served inline: the image type its bytes are. */
  contentType: string | null;
}

/** The attachment as the reader sees it on the board, or 404. */
async function findAttachment(boardId: string, threadId: string, messageId: string, index: number, userId: string, role: Parameters<typeof readBoardView>[1]['role']) {
  const view = await readBoardView(boardId, { userId, role });
  const comments = view.collection('comments');
  if (comments.has(`x:${threadId}`) || comments.has(`x:${threadId}:${messageId}`)) throw notFound('File not found');
  if (!comments.has(`t:${threadId}`)) throw notFound('File not found');
  const m = comments.get(`m:${threadId}:${messageId}`) as Partial<CommentMessageRecord> | undefined;
  if (!m || m.kind !== 'message' || m.threadId !== threadId || !Array.isArray(m.attachments)) throw notFound('File not found');
  const a = m.attachments[index] as Partial<CommentAttachment> | undefined;
  const name = a && typeof a.src === 'string' ? uploadName(a.src) : null;
  if (!a || !name || !name.endsWith(`.${ATTACHMENT_EXT}`)) throw notFound('File not found');
  // Only its author's own upload: a message can't point at a file someone else put elsewhere.
  if ((await repo.getUploadRow(name))?.ownerId !== m.authorId) throw notFound('File not found');
  if (await isUploadRemoved(name)) throw new HttpError(410, 'This file was removed by Freero’s moderators');
  return { name, fileName: typeof a.name === 'string' && a.name.trim() ? a.name.slice(0, 200) : 'download' };
}

export async function openCommentFile(
  boardId: string,
  ref: { threadId: string; messageId: string; index: number },
  userId: string,
  opts: { inline?: boolean; audit?: boolean } = {},
): Promise<CommentFile> {
  if (!Number.isInteger(ref.index) || ref.index < 0 || ref.index > 16) throw notFound('File not found');
  if (opts.inline) {
    // Seeing a picture in a thread is reading the board: anyone who can open it.
    const { role } = await requireBoardAccess(boardId, userId);
    const { name, fileName } = await findAttachment(boardId, ref.threadId, ref.messageId, ref.index, userId, role);
    const head = await openUpload(name, { range: { start: 0, end: 15 } });
    if (!head) throw notFound('File not found');
    const bytes: Buffer[] = [];
    for await (const c of head.body) bytes.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const contentType = INLINE_TYPES.find((t) => contentMatches(Buffer.concat(bytes), t));
    if (!contentType) throw new HttpError(415, 'Only pictures are shown in a thread; download the file instead');
    const obj = await openUpload(name);
    if (!obj) throw notFound('File not found');
    return { body: obj.body, size: obj.size, name: fileName, contentType };
  }
  // Taking the file away is an export: the downloads policy applies, and it is audited.
  const { role, record } = await authorizeFileDownload(boardId, userId);
  const { name, fileName } = await findAttachment(boardId, ref.threadId, ref.messageId, ref.index, userId, role);
  const obj = await openUpload(name);
  if (!obj) throw notFound('File not found');
  if (opts.audit !== false) {
    try {
      await record({ name: fileName, upload: name });
    } catch (e) {
      obj.body.destroy();
      throw e;
    }
  }
  return { body: obj.body, size: obj.size, name: fileName, contentType: null };
}

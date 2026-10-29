// Downloading a file from a board (GET /api/boards/:id/files/:elementId): the one way attachments
// (file cards) are ever served, and the "Download" of video and audio items. The item is looked up
// in the board as the person sees it, so the request can't name a file that isn't theirs to read
// there (another board's, a hidden frame's, someone's private draft), and the name it downloads
// under is the item's own, never one from the request.
import type { Readable } from 'node:stream';
import type { FileElement, MediaElement } from '@freero/shared';
import { HttpError, notFound } from '../../platform/http';
import { storage } from '../../platform/storage';
import { authorizeFileDownload } from '../boards/index';
import { readBoardView } from '../realtime/index';
import { isUploadRemoved, uploadName } from './moderation';

export interface BoardFile {
  body: Readable;
  size: number | null;
  /** The name the item shows (and the file downloads under). */
  name: string;
}

/** An upload's bytes by name (404 / 410 like the routes). The caller decided who may download it. */
export async function openUploadForDownload(name: string): Promise<{ body: Readable; size: number | null }> {
  if (await isUploadRemoved(name)) throw new HttpError(410, 'This file was removed by Freero’s moderators');
  const obj = await storage().get(name);
  if (!obj) throw notFound('File not found');
  return { body: obj.body, size: obj.size };
}

export async function openBoardFile(boardId: string, elementId: string, userId: string, opts: { audit?: boolean } = {}): Promise<BoardFile> {
  // 404 / 403 / 451 like opening the board; 403 when the downloads policy says no.
  const { role, record } = await authorizeFileDownload(boardId, userId);
  const view = await readBoardView(boardId, { userId, role });
  const el = view.elements.find((e) => e.el.id === elementId)?.el;
  if (!el || (el.type !== 'file' && el.type !== 'media')) throw notFound('File not found');
  const item = el as FileElement | MediaElement;
  const name = typeof item.src === 'string' ? uploadName(item.src) : null;
  if (!name) throw notFound('File not found');
  if (await isUploadRemoved(name)) throw new HttpError(410, 'This file was removed by Freero’s moderators');
  const obj = await storage().get(name);
  if (!obj) throw notFound('File not found');
  const fileName = typeof item.name === 'string' && item.name.trim() ? item.name : 'download';
  if (opts.audit !== false) {
    try {
      await record({ name: fileName.slice(0, 200), upload: name });
    } catch (e) {
      obj.body.destroy(); // nothing leaves without its audit record
      throw e;
    }
  }
  return { body: obj.body, size: obj.size, name: fileName };
}

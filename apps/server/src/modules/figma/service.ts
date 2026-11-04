// "Place from Figma" (#171): a person's own Figma account, the files they used, a file's frames,
// and a frame rendered by Figma and copied into their uploads — through the same upload checks as
// any file (its bytes must be the PNG they claim, under the size cap and the person's quota), so a
// placed frame is an ordinary image everyone who can open the board sees, Figma access or not.
import type { FigmaFilesResponse, FigmaFramesResponse, FigmaPlaceResponse, FigmaStatus } from '@freero/shared';
import { figmaFrameLink, figmaNodeId, isFigmaFileKey } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { recordAudit } from '../audit/index';
import { requireBoardAccess } from '../boards/index';
import { imageSize } from '../unfurl/index';
import { saveUpload } from '../uploads/index';
import { downloadRender, FigmaApiError, fileFrames, nodeInfo, renderNodes } from './api';
import * as repo from './repo';
import { withFigmaToken } from './tokens';

/** At most this many frames per file in the picker (each one gets a preview render). */
const MAX_FRAMES = 60;
const PREVIEW_SCALE = 0.25;
/** Placed frames: twice Figma's size for sharp pictures, but the long side at most this. */
const MAX_SIDE = 4096;

export const figmaOffered = () => getConfig().figma !== null;

function offered() {
  if (!figmaOffered()) throw new HttpError(404, 'This server doesn’t offer Place from Figma', 'figma_unavailable');
}

/** Figma's refusals in the person's terms (after withFigmaToken has had its go at a 401). */
function asHttp(e: unknown): never {
  if (!(e instanceof FigmaApiError)) throw e;
  if (e.status === 403) throw new HttpError(403, 'Your Figma account can’t open this file.', 'figma_no_access');
  if (e.status === 404) throw notFound('Figma has no such file or frame.', 'figma_not_found');
  if (e.status === 429) throw new HttpError(429, 'Figma is asking Freero to slow down. Try again in a minute.', 'figma_rate_limited');
  throw new HttpError(502, 'Figma didn’t answer. Try again in a moment.', 'figma_unreachable');
}

export async function figmaStatus(userId: string): Promise<FigmaStatus> {
  offered();
  const a = await repo.account(userId);
  return { connected: a ? { handle: a.handle, email: a.email } : null };
}

export async function disconnectFigma(userId: string): Promise<boolean> {
  const a = await repo.account(userId);
  if (!(await repo.deleteAccount(userId))) return false;
  await recordAudit({ action: 'figma.account_unlinked', accountId: userId, fanOut: false, target: { type: 'figma_account', id: a?.figmaUserId ?? '', label: a?.handle } });
  return true;
}

export async function recentFigmaFiles(userId: string): Promise<FigmaFilesResponse> {
  offered();
  if (!(await repo.account(userId))) return { files: [] };
  return { files: await repo.recentFiles(userId) };
}

export async function figmaFrames(userId: string, fileKey: unknown): Promise<FigmaFramesResponse> {
  offered();
  if (!isFigmaFileKey(fileKey)) throw badRequest('That isn’t a Figma file link.', 'figma_bad_link');
  return withFigmaToken(userId, async (token) => {
    const file = await fileFrames(token, fileKey);
    const listed = file.frames.slice(0, MAX_FRAMES);
    // Previews are a nicety: a file whose renders fail still lists its frames.
    const previews = listed.length ? await renderNodes(token, fileKey, listed.map((f) => f.id), PREVIEW_SCALE).catch(() => ({}) as Record<string, string | null>) : {};
    await repo.touchFile(userId, { key: fileKey, name: file.name, thumbnail: file.thumbnail }, Date.now());
    return {
      file: { key: fileKey, name: file.name },
      frames: listed.map((f) => ({ ...f, preview: previews[f.id]?.startsWith('https://') ? previews[f.id] : null })),
      more: file.frames.length > listed.length,
    };
  }).catch(asHttp);
}

/**
 * Renders a frame and stores the picture with the caller's uploads, for a board they may edit. The
 * same call refreshes a frame placed before (the client swaps the image's `src`).
 */
export async function placeFigmaFrame(boardId: string, userId: string, body: { fileKey?: unknown; nodeId?: unknown } | undefined): Promise<FigmaPlaceResponse> {
  offered();
  await requireBoardAccess(boardId, userId, 'editor');
  const fileKey = body?.fileKey;
  const nodeId = figmaNodeId(body?.nodeId);
  if (!isFigmaFileKey(fileKey) || !nodeId) throw badRequest('Choose a frame of a Figma file.', 'figma_bad_frame');
  const maxBytes = getConfig().maxUploadBytes;
  const bytes = await withFigmaToken(userId, async (token) => {
    const node = await nodeInfo(token, fileKey, nodeId);
    if (!node) throw new FigmaApiError(404, 'no such node');
    const scale = Math.min(2, MAX_SIDE / Math.max(node.w, node.h));
    const url = (await renderNodes(token, fileKey, [nodeId], scale))[nodeId];
    if (!url) throw new HttpError(422, 'Figma couldn’t draw this frame (an empty or hidden frame draws nothing).', 'figma_render_empty');
    return { name: node.name, png: await downloadRender(url, maxBytes) };
  }).catch(asHttp);
  // The upload checks: the bytes must really be a PNG, within the size cap and the quota.
  const src = await saveUpload(bytes.png, 'image/png', userId);
  const dims = imageSize(bytes.png, 'image/png') ?? { w: 800, h: 600 };
  return { url: src, w: dims.w, h: dims.h, link: figmaFrameLink(fileKey, nodeId), name: bytes.name };
}

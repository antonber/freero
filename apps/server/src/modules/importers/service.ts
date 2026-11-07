// "Import from Miro" (#62; docs/design/importers.md): reads one of the person's own Miro boards with
// THEIR OWN token, for a board they may edit, and answers it as @freero/shared MiroImportResponse.
// The token is a local of this one request: it is never stored, never logged (no error or answer
// carries it) and only ever sent to Miro's API origin. Pictures are copied into the person's
// uploads through the upload checks (the bytes must be the image they claim, within the size cap
// and their quota), so the board never loads anything from Miro. Bounded: MIRO_MAX_ITEMS items and
// as many connectors, MIRO_MAX_IMAGES pictures, one deadline for the whole read.
import type { MiroImportResponse, MiroItem } from '@freero/shared';
import { MIRO_MAX_IMAGES, miroBoardId } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError } from '../../platform/http';
import { requireBoardAccess } from '../boards/index';
import { contentMatches, saveUpload } from '../uploads/index';
import { imageSize, importImageFromUrl } from '../unfurl/index';
import { apiUrl, atApiOrigin, boardConnectors, boardItems, boardName, boardTags, miroGet, MiroApiError } from './miro';

/** The whole read (pages and pictures) ends by then; a board that takes longer is refused. */
const DEADLINE_MS = 120_000;
const IMAGE_CONCURRENCY = 4;
const RASTER = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Miro's refusals in the person's terms. Never echoes anything Miro or the person sent. */
function asHttp(e: unknown): never {
  if (!(e instanceof MiroApiError)) throw e;
  if (e.status === 401) throw badRequest('Miro didn’t accept that token. Check it and try again.', 'miro_token_refused');
  if (e.status === 403) throw new HttpError(403, 'That token can’t read this board.', 'miro_no_access');
  if (e.status === 404) throw new HttpError(404, 'Miro has no such board, or the token’s team can’t see it.', 'miro_not_found');
  if (e.status === 429) throw new HttpError(429, 'Miro is asking Freero to slow down. Try again in a minute.', 'miro_rate_limited');
  throw new HttpError(502, 'Miro didn’t answer. Try again in a moment.', 'miro_unreachable');
}

/**
 * One picture: Miro's image link (at its API origin, with the token, `redirect=false`) says where
 * the file is; the file itself is fetched WITHOUT the token — through the SSRF-safe fetch (https
 * only) unless it is at the API's own origin (a stand-in) — and stored with the upload checks.
 */
async function copyPicture(imageUrl: string, token: string, userId: string, workspaceId: string | null, deadline: number): Promise<MiroItem['image']> {
  if (!atApiOrigin(imageUrl)) return null;
  const maxBytes = getConfig().maxUploadBytes;
  try {
    const link = new URL(imageUrl);
    link.searchParams.set('format', 'original');
    link.searchParams.set('redirect', 'false');
    const answer = await miroGet(link.toString(), token, deadline);
    let bytes: Buffer;
    if (answer.type.startsWith('image/')) bytes = answer.bytes;
    else {
      const at = (answer.body as { url?: unknown } | null)?.url;
      if (typeof at !== 'string' || !/^https?:\/\//.test(at)) return null;
      if (!atApiOrigin(at)) {
        const placed = await importImageFromUrl(at, userId, maxBytes, workspaceId);
        return { url: placed.src, w: placed.w, h: placed.h };
      }
      const res = await fetch(at, { redirect: 'error', signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
      if (!res.ok) return null;
      bytes = Buffer.from(await res.arrayBuffer());
    }
    if (bytes.byteLength > maxBytes) return null;
    const type = RASTER.find((t) => contentMatches(bytes, t));
    if (!type) return null;
    const url = await saveUpload(bytes, type, userId, { workspaceId });
    const size = imageSize(bytes, type) ?? { w: 800, h: 600 };
    return { url, w: size.w, h: size.h };
  } catch {
    // Unreachable, not an image, over the size cap or the quota: this picture is left out and the
    // import report says so; the rest of the board still comes.
    return null;
  }
}

async function eachLimited<T>(list: T[], limit: number, run: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (next < list.length) await run(list[next++]);
    }),
  );
}

/** The person cancelled (their browser went away): nothing more is read or copied. Nobody gets this answer. */
class ImportCancelled extends HttpError {
  constructor() {
    super(400, 'The import was cancelled.', 'import_cancelled');
  }
}

/**
 * `cancelled`: aborted when the person cancels (the request's connection closes) — the read stops
 * between Miro calls and before each picture, so a cancelled import copies nothing more into their
 * uploads (#193).
 */
export async function importFromMiro(
  boardId: string,
  userId: string,
  body: { board?: unknown; token?: unknown } | undefined,
  cancelled?: AbortSignal,
): Promise<MiroImportResponse> {
  apiUrl(); // 404 where the operator turned it off
  const access = await requireBoardAccess(boardId, userId, 'editor');
  const miroId = miroBoardId(body?.board);
  if (!miroId) throw badRequest('Paste the link of a Miro board (miro.com/app/board/…).', 'miro_bad_link');
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!/^[\x21-\x7e]{8,2048}$/.test(token)) throw badRequest('Miro didn’t accept that token. Check it and try again.', 'miro_token_refused');
  const deadline = Date.now() + DEADLINE_MS;
  const stopIfCancelled = () => {
    if (cancelled?.aborted) throw new ImportCancelled();
  };
  try {
    const name = await boardName(miroId, token, deadline);
    stopIfCancelled();
    const items = await boardItems(miroId, token, deadline);
    stopIfCancelled();
    const connectors = await boardConnectors(miroId, token, deadline);
    stopIfCancelled();
    const tags = await boardTags(miroId, token, deadline).catch(() => []);
    const pictures = items.list.filter((r) => r.imageUrl);
    const copied = pictures.slice(0, MIRO_MAX_IMAGES);
    await eachLimited(copied, IMAGE_CONCURRENCY, async (r) => {
      stopIfCancelled();
      r.item.image = await copyPicture(r.imageUrl!, token, userId, access.workspaceId ?? null, deadline);
    });
    stopIfCancelled();
    for (const r of pictures.slice(MIRO_MAX_IMAGES)) r.item.image = null;
    return {
      board: { name },
      items: items.list.map((r) => r.item),
      connectors: connectors.list,
      tags,
      truncated: items.truncated || connectors.truncated,
      imagesOverCap: Math.max(0, pictures.length - MIRO_MAX_IMAGES),
    };
  } catch (e) {
    return asHttp(e);
  }
}

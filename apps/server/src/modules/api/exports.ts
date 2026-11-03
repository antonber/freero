// Board pictures over the API and MCP (#33): PNG, SVG or PDF drawn on the server (modules/render),
// as an export — refused like one by the workspace's downloads policy and the board's "viewers and
// commenters can copy and export", recorded as `board.exported` — under a rate limit of its own.
// REST answers the file; MCP answers a picture it can show and / or a single-use download link
// (apiauth export tickets: never the session cookie, never the connection's own token).
import type { Request } from 'express';
import { HttpError } from '../../platform/http';
import { appUrl } from '../../platform/mail';
import { consumeRateLimit } from '../../platform/rateLimit';
import { mintExportTicket, redeemExportTicket } from '../apiauth/index';
import { recordBoardExport, requireBoardDownload } from '../boards/index';
import { readRenderSpec, renderBoard, type Rendered } from '../render/index';
import { newApiCall, openBoard, type ApiCall } from './service';

/** Draws the board as the caller sees it, after the export checks; one `board.exported` event. */
export async function renderForApi(
  call: ApiCall,
  boardId: string,
  body: { format?: unknown; frameId?: unknown; scale?: unknown },
  opts: { fit?: number } = {},
): Promise<Rendered & { filename: string }> {
  const spec = { ...readRenderSpec(body), ...opts };
  const board = await openBoard(call, boardId);
  await consumeRateLimit('boardRender', `user:${call.userId}`);
  await recordBoardExport(board.id, call.userId, spec.format);
  const out = await renderBoard(board.id, { userId: call.userId, role: board.role }, board.title, spec);
  call.audit.metadata = { format: spec.format, items: out.items, ...(spec.frameId ? { frameId: spec.frameId } : {}) };
  const name = board.title.replace(/[^\p{L}\p{N} _.-]+/gu, '').trim().slice(0, 80) || 'board';
  return { ...out, filename: `${name}.${out.extension}` };
}

/**
 * A single-use link that downloads the picture, drawn when it is used (EXPORT_TICKET_MS). The
 * downloads policy is checked now too, so a refusal comes back at once rather than as a dead link.
 */
export async function exportLink(call: ApiCall, boardId: string, body: { format?: unknown; frameId?: unknown; scale?: unknown }): Promise<{ url: string; expiresAt: number }> {
  const spec = readRenderSpec(body);
  const board = await openBoard(call, boardId);
  await requireBoardDownload(board.id, call.userId, 'export');
  const { ticket, expiresAt } = await mintExportTicket(call.cred, board.id, { ...spec });
  return { url: appUrl(call.req, `/api/v1/exports/${ticket}`), expiresAt };
}

/**
 * Redeems a download link (once): the call it acts as — the credential that asked for it, checked
 * afresh — the board and what to draw. The caller then draws it with renderForApi, which checks the
 * person's access, the team's API switch, the downloads policy and the rate limit again now.
 * 404 for an unknown, used or expired link.
 */
export async function redeemExport(req: Request, ticket: string): Promise<{ call: ApiCall; boardId: string; spec: Record<string, unknown> }> {
  const r = await redeemExportTicket(ticket);
  if (!r) throw new HttpError(404, 'This download link was already used or has expired: export the board again', 'export_link_gone');
  return { call: newApiCall(req, r.cred), boardId: r.boardId, spec: r.spec };
}

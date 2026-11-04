// POST /api/v1/boards/{boardId}/images (#172): a picture sent as its bytes — what an app holds when
// it made the picture itself (the Figma plugin exports frames in Figma) — stored through the upload
// checks (its bytes decide its type, the size cap, the caller's quota) and placed as an image item.
//
// Sending a picture again updates instead of duplicating: `replace` names the item an app placed
// before (the plugin remembers it per frame and board), or else an image whose `link` points at
// the same thing (`sameFigmaFrame`: the same Figma frame, however its link is written) gets the
// new picture — in its place, as wide as it was, at the new proportions.
import { contentMatches, saveUpload } from '../uploads/index';
import { imageSize } from '../unfurl/index';
import { sameFigmaFrame, type ImageElement } from '@freero/shared';
import { badRequest, HttpError } from '../../platform/http';
import { consumeRateLimit } from '../../platform/rateLimit';
import { requireBoardAccess } from '../boards/index';
import { changeBoard, readBoardView } from '../realtime/index';
import { newElementId } from '../structure/index';
import { planCreate, toApiItem, type UrlItem } from './items';
import { actorOf, agentWrite, change, openBoard, present, withNotice, type ApiCall } from './service';

const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function queryText(v: unknown, field: string, max: number): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.length > max) throw badRequest(`${field} must be text of at most ${max} characters`);
  return v;
}

export async function putImage(call: ApiCall, boardId: string, body: unknown, query: Record<string, unknown>) {
  if (!Buffer.isBuffer(body) || !body.length) throw badRequest('Send the picture’s bytes as the request body (Content-Type image/png, image/jpeg, image/gif or image/webp)');
  const link = queryText(query.link, 'link', 2000);
  if (link !== undefined && !/^https?:\/\//i.test(link)) throw badRequest('link must be an http(s) URL');
  const alt = queryText(query.alt, 'alt', 500);
  const replace = queryText(query.replace, 'replace', 200);
  const { id, role } = await openBoard(call, boardId);
  await requireBoardAccess(id, call.userId, 'editor');
  await agentWrite(call, { id, role });
  await consumeRateLimit('upload', `user:${call.userId}`);
  // The type the bytes are, whatever the request said; the upload checks then hold it to that.
  const type = TYPES.find((t) => contentMatches(body, t));
  if (!type) throw new HttpError(415, 'That isn’t a PNG, JPEG, GIF or WebP picture');
  const src = await saveUpload(body, type, call.userId);
  const size = imageSize(body, type) ?? { w: 800, h: 600 };

  let replaced = false;
  const out = await change(() =>
    changeBoard(id, actorOf(call, role), (view) => {
      const images = view.elements.map((e) => e.el).filter((el): el is ImageElement => el.type === 'image' && !el.locked);
      const target = (replace ? images.find((el) => el.id === replace) : undefined) ?? (link ? images.find((el) => typeof el.link === 'string' && sameFigmaFrame(el.link, link)) : undefined);
      if (target) {
        replaced = true;
        const h = Math.max(8, Math.round((target.w * size.h) / size.w));
        const patch = { src, naturalW: size.w, naturalH: size.h, crop: null, h, y: Math.round(target.y + (target.h - h) / 2), ...(link ? { link } : {}), ...(alt !== undefined ? { alt } : {}) };
        return { change: { update: [{ id: target.id, patch }] }, ids: [target.id] };
      }
      const input = { type: 'image', url: src, ...(link ? { link } : {}), ...(alt !== undefined ? { alt } : {}) };
      const fetched = new Map<Record<string, unknown>, UrlItem>([[input, { type: 'image', src, naturalW: size.w, naturalH: size.h }]]);
      return planCreate([input], view, newElementId, fetched);
    }),
  );
  const view = await readBoardView(id, { userId: call.userId, role });
  const hit = view.elements.find((e) => e.el.id === out.ids[0]);
  call.audit.metadata = { items: 1, replaced };
  present(call, id, out.ids, view);
  return { status: replaced ? 200 : 201, body: withNotice({ item: hit ? toApiItem(hit.el, hit.layer) : null, replaced }) };
}

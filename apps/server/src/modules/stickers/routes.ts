import express, { Router } from 'express';
import { MAX_STICKER_BYTES, type Sticker, type StickerSet, type StickersResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle, HttpError } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { addSticker, createSet, listStickers, removeSet, removeSticker } from './service';

type Out = StickersResponse | { set: StickerSet } | { sticker: Sticker } | { ok: true };

export default function stickerRoutes(_ctx: ServerContext): Router {
  const r = Router();

  r.get(
    '/boards/:id/stickers',
    requireUser,
    handle(async (req, res) => {
      res.json((await listStickers(req.params.id, currentUser(req).id)) satisfies Out);
    }),
  );

  r.post(
    '/boards/:id/sticker-sets',
    requireUser,
    handle(async (req, res) => {
      res.status(201).json({ set: await createSet(req.params.id, currentUser(req).id, req.body) } satisfies Out);
    }),
  );

  // The image itself is the body, read up to the sticker cap (a bigger one is refused unread).
  const body = express.raw({ type: () => true, limit: MAX_STICKER_BYTES });
  r.post(
    '/sticker-sets/:id/stickers',
    requireUser,
    rateLimit('upload', 'user'),
    (req, res, next) =>
      body(req, res, (err?: unknown) =>
        next((err as { type?: string } | undefined)?.type === 'entity.too.large' ? new HttpError(413, `A sticker can be at most ${MAX_STICKER_BYTES / 1024}KB`) : err),
      ),
    handle(async (req, res) => {
      const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const sticker = await addSticker(req.params.id, currentUser(req).id, data, req.headers['content-type'] ?? '', req.query.name);
      res.status(201).json({ sticker } satisfies Out);
    }),
  );

  r.delete(
    '/sticker-sets/:id',
    requireUser,
    handle(async (req, res) => {
      await removeSet(req.params.id, currentUser(req).id);
      res.json({ ok: true } satisfies Out);
    }),
  );

  r.delete(
    '/sticker-sets/:id/stickers/:stickerId',
    requireUser,
    handle(async (req, res) => {
      await removeSticker(req.params.id, req.params.stickerId, currentUser(req).id);
      res.json({ ok: true } satisfies Out);
    }),
  );

  return r;
}

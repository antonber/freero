import { Router } from 'express';
import type { GifPlaceResponse, GifSearchResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { gifPreview, placeGif, searchGifs } from './service';

// A proxied preview is never rendered as a page in our origin (same policy as /uploads).
const SANDBOX_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox";

/** GIF search (#139; contract in @freero/shared api.ts "GIF search"). */
export default function gifRoutes(_ctx: ServerContext): Router {
  const r = Router();

  r.get(
    '/boards/:id/gifs',
    requireUser,
    rateLimit('gifSearch', 'user'),
    handle(async (req, res) => {
      const user = currentUser(req);
      const out = await searchGifs(req.params.id, user.id, req.query.q, req.query.pos, user.locale ?? 'en');
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(out satisfies GifSearchResponse);
    }),
  );

  r.get(
    '/gifs/media',
    requireUser,
    handle(async (req, res) => {
      const img = await gifPreview(req.query.m);
      res.setHeader('Content-Type', img.type);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', SANDBOX_CSP);
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
      res.send(img.body);
    }),
  );

  r.post(
    '/boards/:id/gifs/place',
    requireUser,
    rateLimit('remoteImage', 'user'),
    rateLimit('upload', 'user'),
    handle(async (req, res) => {
      res.status(201).json((await placeGif(req.params.id, currentUser(req).id, req.body?.media)) satisfies GifPlaceResponse);
    }),
  );

  return r;
}

// The installed app's share target (KAI-218, the web manifest's `share_target`): the system share
// sheet POSTs images, a link and text here as a multipart form. Images are stored like any upload
// of the signed-in person (type and bytes checked, their quota), and the browser is sent on to the
// app's /share page with what arrived, where they pick the board it goes on.
//
// No exception to the CSRF check is needed or made: the share sheet's request is browser-initiated
// (no cross-site Origin), and a cross-site form posting here is refused like any other. Nothing is
// put on a board here — only the person, on the next page, chooses where it goes.
import express, { Router, type Response } from 'express';
import type { ServerContext } from '../../platform/context';
import { getConfig } from '../../platform/config';
import { handle } from '../../platform/http';
import { log } from '../../platform/log';
import { rateLimit } from '../../platform/rateLimit';
import { userFromCookieHeader } from '../auth/index';
import { saveUpload } from '../uploads/index';

const MAX_IMAGES = 10;
const MAX_TEXT = 2000;

const field = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '');

/** 303 to the app (a full navigation: the share sheet opened this URL). */
const goTo = (res: Response, path: string) => res.redirect(303, path);

export default function shareRoutes(_ctx: ServerContext): Router {
  const r = Router();
  // A few images at their upload size cap, read into memory once; more is refused before reading.
  const limit = () => getConfig().maxUploadBytes * 4 + 64 * 1024;

  r.post(
    '/share-target',
    rateLimit('upload', 'ip'),
    (req, res, next) => {
      if (Number(req.headers['content-length']) > limit()) return goTo(res, `/share?error=${encodeURIComponent('That was too much to share at once.')}`);
      express.raw({ type: () => true, limit: limit() })(req, res, (err?: unknown) =>
        err ? goTo(res, `/share?error=${encodeURIComponent('That was too much to share at once.')}`) : next(),
      );
    },
    handle(async (req, res) => {
      const user = await userFromCookieHeader(req.headers.cookie);
      // Signed out: what was shared can't wait anywhere; sign in and share again.
      if (!user) return goTo(res, '/login?next=%2Fapp');
      const body: unknown = req.body;
      let form: FormData;
      try {
        form = await new Request('http://share.local/', {
          method: 'POST',
          headers: { 'content-type': String(req.headers['content-type'] ?? '') },
          body: Buffer.isBuffer(body) ? new Uint8Array(body) : new Uint8Array(),
        }).formData();
      } catch {
        return goTo(res, `/share?error=${encodeURIComponent('Nothing readable arrived from the share.')}`);
      }
      const q = new URLSearchParams();
      for (const k of ['title', 'text', 'url'] as const) {
        const v = field(form.get(k));
        if (v) q.set(k, v);
      }
      let failed = 0;
      for (const f of form.getAll('images').slice(0, MAX_IMAGES)) {
        if (typeof f === 'string') continue;
        try {
          const url = await saveUpload(new Uint8Array(await f.arrayBuffer()), f.type, user.id);
          q.append('i', url.slice('/uploads/'.length));
        } catch {
          failed++; // not an image we store, too large, or over the quota
        }
      }
      if (failed) q.set('failed', String(failed));
      log(`share: ${q.getAll('i').length} images shared into the app by ${user.id}${failed ? ` (${failed} refused)` : ''}`);
      goTo(res, `/share?${q}`);
    }),
  );

  return r;
}

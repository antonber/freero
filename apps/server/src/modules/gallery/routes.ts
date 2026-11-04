// The community template gallery (#162; contract: @freero/shared api.ts "Community template
// gallery"). Mounted at the root: its public pages (/gallery, /gallery/:id, the preview pictures,
// the sitemap) are pages of the marketing site, filled by modules/site; the rest is /api/gallery.
// Routers mount in readdir order, so these come before modules/site's catch-all.
import { Router, type Request, type Response } from 'express';
import { GALLERY_CATEGORIES, type GalleryTemplate, type OwnGalleryTemplate } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle, notFound } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, isOperator, requireUser } from '../auth/index';
import { fillShell, fillSlot, sendSiteHtml, sendSiteNotFound, sitePageText, siteShellText } from '../site/index';
import { hubBody, sitemapXml, templateBody, templateDescription } from './pages';
import { installTemplate, ownTemplates, previewFor, publicTemplate, publicTemplates, submitTemplate, withdrawTemplate } from './service';

export const mountPath = '/';

/** The shell of a template's page in the site build (apps/site build.tsx). */
const SHELL = 'gallery-template';

const noStore = (res: Response) => res.setHeader('Cache-Control', 'private, no-store');

/** An SVG we drew ourselves, sent so that nothing in it could run even if it tried. */
function sendSvg(res: Response, svg: string, cache: string) {
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', cache);
  res.send(svg);
}

export default function galleryRoutes({ config }: ServerContext): Router {
  const r = Router();
  const origin = (req: Request) => config.publicUrl ?? `${req.protocol}://${req.get('host') ?? 'localhost'}`;

  // ---- API ----
  r.get(
    '/api/gallery',
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.json({ templates: await publicTemplates(req.query.q, req.query.category) } satisfies { templates: GalleryTemplate[] });
    }),
  );
  r.get(
    '/api/gallery/mine',
    requireUser,
    handle(async (req, res) => {
      noStore(res);
      res.json({ templates: await ownTemplates(currentUser(req).id) } satisfies { templates: OwnGalleryTemplate[] });
    }),
  );
  r.get(
    '/api/gallery/:id',
    handle(async (req, res) => {
      const t = await publicTemplate(req.params.id);
      if (!t) throw notFound('No such template');
      res.setHeader('Cache-Control', 'no-cache');
      res.json({ template: t } satisfies { template: GalleryTemplate });
    }),
  );
  // Its submitter's and operators' view of the picture, whatever the status.
  r.get(
    '/api/gallery/:id/preview.svg',
    requireUser,
    handle(async (req, res) => {
      const user = currentUser(req);
      const svg = await previewFor(req.params.id, { userId: user.id, operator: isOperator(user) });
      if (svg === null) throw notFound('No such template');
      sendSvg(res, svg, 'private, no-store');
    }),
  );
  r.post(
    '/api/gallery',
    requireUser,
    rateLimit('gallerySubmit', 'user'),
    handle(async (req, res) => {
      res.status(201).json({ template: await submitTemplate(currentUser(req), (req.body ?? {}) as Record<string, unknown>) } satisfies { template: OwnGalleryTemplate });
    }),
  );
  r.delete(
    '/api/gallery/:id',
    requireUser,
    handle(async (req, res) => {
      await withdrawTemplate(currentUser(req).id, req.params.id);
      res.json({ ok: true });
    }),
  );
  r.post(
    '/api/gallery/:id/install',
    requireUser,
    handle(async (req, res) => {
      res.status(201).json(await installTemplate(currentUser(req).id, req.params.id, (req.body ?? {}) as Record<string, unknown>));
    }),
  );

  // ---- public pages (only with a site build; without one the app answers these paths) ----
  r.get(
    '/gallery',
    handle(async (req, res, next) => {
      const page = sitePageText(config, req, '/gallery');
      if (page === null) return next();
      const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100).trim() : '';
      const category = GALLERY_CATEGORIES.some((c) => c.id === req.query.category) ? (req.query.category as string) : null;
      const list = await publicTemplates(q, category);
      // A search or a filter is a view of the hub, not a page of its own.
      sendSiteHtml(config, req, res, fillSlot(page, 'gallery', hubBody(list, q, category)), { noindex: !!(q || category) });
    }),
  );
  r.get(
    '/sitemap-community.xml',
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.type('application/xml').send(sitemapXml(origin(req), await publicTemplates('', null)));
    }),
  );
  r.get(
    '/gallery/:id',
    handle(async (req, res, next) => {
      const shell = siteShellText(config, req, SHELL);
      if (shell === null) return next();
      const t = await publicTemplate(req.params.id);
      if (!t) return void (sendSiteNotFound(config, req, res) || next());
      const html = fillShell(shell, { title: `${t.title}: a community template`.slice(0, 60), description: templateDescription(t), name: t.title, path: t.url }, templateBody(t));
      sendSiteHtml(config, req, res, html);
    }),
  );
  r.get(
    '/gallery/:id/preview.svg',
    handle(async (req, res) => {
      const svg = await previewFor(req.params.id, { userId: null, operator: false });
      if (svg === null) return void res.status(404).type('text/plain').send('Not found\n');
      // Short-lived: a template taken down stops showing within minutes, also from caches.
      sendSvg(res, svg, 'public, max-age=300');
    }),
  );

  return r;
}

import { Router, type RequestHandler } from 'express';
import type { ServerContext } from '../../platform/context';
import { getConfig } from '../../platform/config';
import { handle, notFound } from '../../platform/http';
import { clientIp, consumeRateLimit, rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser, userFromCookieHeader } from '../auth/index';
import {
  act,
  appealInfo,
  boardDetail,
  boardPreview,
  isOperator,
  queue,
  resolve,
  submitAppeal,
  submitReport,
  uploadDetail,
  uploadFileForReview,
  userByEmail,
} from './service';

// Mounted at the root: it serves /.well-known/security.txt besides its /api routes. Reports live
// at /api/reports (not under /api/boards, whose routes require a session: visitors report too).
export const mountPath = '/';

/** 404 for everyone but operators: the moderation API doesn't announce itself. */
const operatorOnly: RequestHandler = (req, _res, next) => (isOperator(currentUser(req)) ? next() : next(notFound()));

const SECURITY_TXT_TTL_MS = 180 * 86_400_000;

export default function moderationRoutes(_ctx: ServerContext): Router {
  const r = Router();

  // RFC 9116. Expires is always ~6 months ahead: the file is generated from live configuration.
  r.get('/.well-known/security.txt', (_req, res) => {
    const config = getConfig();
    if (!config.securityContact) return void res.status(404).type('text/plain').send('Not found\n');
    const lines = [
      `Contact: ${config.securityContact}`,
      ...(config.abuseContactEmail && `mailto:${config.abuseContactEmail}` !== config.securityContact ? [`Contact: mailto:${config.abuseContactEmail}`] : []),
      `Expires: ${new Date(Date.now() + SECURITY_TXT_TTL_MS).toISOString().replace(/\.\d+Z$/, 'Z')}`,
      'Preferred-Languages: en',
      ...(config.publicUrl ? [`Canonical: ${config.publicUrl}/.well-known/security.txt`] : []),
    ];
    res.type('text/plain').setHeader('Cache-Control', 'public, max-age=3600');
    res.send(`${lines.join('\n')}\n`);
  });

  // Anyone who can open the board, with or without an account: per address, and per account too.
  r.post(
    '/api/reports',
    rateLimit('report'),
    handle(async (req, res) => {
      const user = await userFromCookieHeader(req.headers.cookie);
      if (user) await consumeRateLimit('report', `user:${user.id}`);
      await submitReport((req.body ?? {}) as Record<string, unknown>, { userId: user?.id ?? null, ip: clientIp(req) });
      res.status(202).json({ ok: true });
    }),
  );

  // Appeals: the signed link from a notice; no session (a suspended account appeals too).
  r.get(
    '/api/appeals/:token',
    handle(async (req, res) => {
      res.json({ appeal: await appealInfo(req.params.token) });
    }),
  );
  r.post(
    '/api/appeals',
    rateLimit('appeal'),
    handle(async (req, res) => {
      await submitAppeal((req.body ?? {}) as Record<string, unknown>);
      res.status(202).json({ ok: true });
    }),
  );

  r.get(
    '/api/moderation/access',
    requireUser,
    handle(async (req, res) => {
      res.json({ operator: isOperator(currentUser(req)) });
    }),
  );

  const ops = Router();
  ops.use(requireUser, operatorOnly);
  ops.get(
    '/queue',
    handle(async (req, res) => {
      res.json({ items: await queue(req.query.status === 'closed' ? 'closed' : 'open') });
    }),
  );
  ops.get(
    '/boards/:id',
    handle(async (req, res) => {
      res.json(await boardDetail(req.params.id));
    }),
  );
  ops.get(
    '/boards/:id/preview',
    handle(async (req, res) => {
      const state = await boardPreview(req.params.id);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.send(Buffer.from(state));
    }),
  );
  ops.get(
    '/uploads/:name',
    handle(async (req, res) => {
      res.json({ upload: await uploadDetail(req.params.name) });
    }),
  );
  // A reported file, to review before acting (KAI-205): always an attachment, never rendered here.
  ops.get(
    '/uploads/:name/file',
    handle(async (req, res) => {
      const file = await uploadFileForReview(currentUser(req).id, req.params.name);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'no-store');
      if (file.size !== null) res.setHeader('Content-Length', String(file.size));
      file.body.on('error', () => res.destroy());
      file.body.pipe(res);
    }),
  );
  ops.get(
    '/users',
    handle(async (req, res) => {
      res.json({ user: await userByEmail(req.query.email) });
    }),
  );
  ops.post(
    '/actions',
    handle(async (req, res) => {
      res.json({ action: await act(currentUser(req).id, (req.body ?? {}) as Record<string, unknown>) });
    }),
  );
  ops.post(
    '/items/:id/resolve',
    handle(async (req, res) => {
      res.json({ item: await resolve(currentUser(req).id, req.params.id, (req.body ?? {}) as Record<string, unknown>) });
    }),
  );
  r.use('/api/moderation', ops);

  return r;
}

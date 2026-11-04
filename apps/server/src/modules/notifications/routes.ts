import { Router } from 'express';
import type { BoardChangesFrequency, NotificationType } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, handle } from '../../platform/http';
import { currentUser, requireUser } from '../auth/index';
import { listFor, markRead, prefsFor, unsubscribe, updatePrefs } from './service';

const MAX_IDS = 200;
const FREQUENCIES: BoardChangesFrequency[] = ['off', 'daily', 'weekly'];

export default function notificationRoutes(_ctx: ServerContext): Router {
  const r = Router();

  // The signed link from a digest email (and the RFC 8058 one-click POST mail apps send): no
  // session, so it works from any device. Turns every notification email off.
  r.post(
    '/notifications/unsubscribe',
    handle(async (req, res) => {
      const body = req.body as { token?: unknown; list?: unknown } | undefined;
      const token = String(req.query.token ?? body?.token ?? '');
      const list = req.query.list ?? body?.list;
      const email = token ? await unsubscribe(token, list === undefined || list === '' ? undefined : String(list)) : null;
      if (!email) throw badRequest('This unsubscribe link is not valid.');
      res.json({ ok: true, email, list: list ? String(list) : 'all' });
    }),
  );

  r.use('/notifications', requireUser);

  r.get(
    '/notifications',
    handle(async (req, res) => {
      const before = Number(req.query.before);
      const limit = Number(req.query.limit);
      res.json(
        await listFor(currentUser(req).id, {
          before: Number.isFinite(before) && before > 0 ? before : null,
          limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
        }),
      );
    }),
  );

  r.post(
    '/notifications/read',
    handle(async (req, res) => {
      const raw = (req.body ?? {}) as { ids?: unknown };
      let ids: string[] | null = null;
      if (raw.ids !== undefined) {
        if (!Array.isArray(raw.ids) || raw.ids.length > MAX_IDS || !raw.ids.every((i) => typeof i === 'string'))
          throw badRequest(`ids must be a list of at most ${MAX_IDS} notification ids`);
        ids = raw.ids as string[];
      }
      res.json({ unread: await markRead(currentUser(req).id, ids) });
    }),
  );

  r.get(
    '/notifications/prefs',
    handle(async (req, res) => {
      res.json(await prefsFor(currentUser(req).id));
    }),
  );

  r.put(
    '/notifications/prefs',
    handle(async (req, res) => {
      const body = (req.body ?? {}) as { emailAll?: unknown; email?: unknown; slack?: unknown; boardChanges?: unknown; boardComments?: unknown };
      if (body.emailAll !== undefined && typeof body.emailAll !== 'boolean') throw badRequest('emailAll must be true or false');
      if (body.boardComments !== undefined && typeof body.boardComments !== 'boolean') throw badRequest('boardComments must be true or false');
      if (body.boardChanges !== undefined && !FREQUENCIES.includes(body.boardChanges as BoardChangesFrequency))
        throw badRequest('boardChanges must be off, daily or weekly');
      if (body.email !== undefined && (typeof body.email !== 'object' || body.email === null)) throw badRequest('email must map types to true or false');
      if (body.slack !== undefined && (typeof body.slack !== 'object' || body.slack === null)) throw badRequest('slack must map types to true or false');
      res.json(
        await updatePrefs(currentUser(req).id, {
          emailAll: body.emailAll as boolean | undefined,
          email: body.email as Partial<Record<NotificationType, boolean>> | undefined,
          slack: body.slack as Partial<Record<NotificationType, boolean>> | undefined,
          boardChanges: body.boardChanges as BoardChangesFrequency | undefined,
          boardComments: body.boardComments as boolean | undefined,
        }),
      );
    }),
  );

  return r;
}

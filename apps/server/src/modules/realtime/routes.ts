// Version history routes (contract: @freero/shared api.ts "Version history"). Editors and owners only.
import { Router } from 'express';
import type { BoardVersion } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import {
  cleanVersionName,
  listVersions,
  nameCurrentVersion,
  parseVersionId,
  renameVersion,
  requireVersionAccess,
  restoreVersion,
  versionState,
} from './history';

type Out = { versions: BoardVersion[] } | { version: BoardVersion } | { before: BoardVersion };

export default function versionRoutes(_ctx: ServerContext): Router {
  const r = Router();
  const base = '/boards/:id/versions';
  r.use(base, requireUser);

  r.get(
    base,
    handle(async (req, res) => {
      await requireVersionAccess(req.params.id, currentUser(req).id);
      res.json({ versions: await listVersions(req.params.id) } satisfies Out);
    }),
  );

  r.get(
    `${base}/:vid/state`,
    handle(async (req, res) => {
      await requireVersionAccess(req.params.id, currentUser(req).id);
      const state = await versionState(req.params.id, parseVersionId(req.params.vid));
      res.setHeader('Cache-Control', 'private, no-store');
      res.type('application/octet-stream').send(Buffer.from(state.buffer, state.byteOffset, state.byteLength));
    }),
  );

  r.post(
    base,
    rateLimit('version', 'user'),
    handle(async (req, res) => {
      const user = currentUser(req);
      await requireVersionAccess(req.params.id, user.id);
      const name = cleanVersionName(req.body?.name);
      res.status(201).json({ version: await nameCurrentVersion(req.params.id, user.id, name) } satisfies Out);
    }),
  );

  r.patch(
    `${base}/:vid`,
    rateLimit('version', 'user'),
    handle(async (req, res) => {
      await requireVersionAccess(req.params.id, currentUser(req).id);
      const name = cleanVersionName(req.body?.name);
      res.json({ version: await renameVersion(req.params.id, parseVersionId(req.params.vid), name) } satisfies Out);
    }),
  );

  r.post(
    `${base}/:vid/restore`,
    rateLimit('version', 'user'),
    handle(async (req, res) => {
      const user = currentUser(req);
      await requireVersionAccess(req.params.id, user.id);
      res.json({ before: await restoreVersion(req.params.id, parseVersionId(req.params.vid), user.id) } satisfies Out);
    }),
  );

  return r;
}

// The phone and tablet apps (#177; contract in @freero/shared api.ts "Push notifications…"):
//   GET    /api/mobile/push                  which kinds of device this server sends push notifications to
//   PUT    /api/mobile/push/devices           this device's push token, for this account and session
//   DELETE /api/mobile/push/devices           forget it
//   GET    /.well-known/apple-app-site-association, /.well-known/assetlinks.json
//          which apps https links on this server may open (only when the operator named them)
import { Router } from 'express';
import type { MobilePushStatus } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { getConfig } from '../../platform/config';
import { handle, notFound } from '../../platform/http';
import { currentSessionKey, currentUser, requireUser } from '../auth/index';
import { pushStatus, registerDevice, unregisterDevice } from './service';

// Mounted at the root for the two /.well-known files; the API routes spell out /api.
export const mountPath = '/';

/** The app paths links may open in the app: boards and docs (the rest stays in the browser). */
const APP_PATHS = ['/board/*', '/doc/*'];

export default function mobileRoutes(_ctx: ServerContext): Router {
  const r = Router();

  r.get('/api/mobile/push', requireUser, (_req, res) => res.json(pushStatus() satisfies MobilePushStatus));
  r.put('/api/mobile/push/devices', requireUser, handle(async (req, res) => res.json(await registerDevice(currentUser(req).id, currentSessionKey(req), req.body))));
  r.delete('/api/mobile/push/devices', requireUser, handle(async (req, res) => res.json(await unregisterDevice(currentUser(req).id, req.body?.token))));

  r.get('/.well-known/apple-app-site-association', (_req, res, next) => {
    const appID = getConfig().mobileApps.appleAppId;
    if (!appID) return next(notFound());
    res.type('application/json').json({ applinks: { details: [{ appIDs: [appID], components: APP_PATHS.map((p) => ({ '/': p })) }] } });
  });
  r.get('/.well-known/assetlinks.json', (_req, res, next) => {
    const android = getConfig().mobileApps.android;
    if (!android) return next(notFound());
    res.json([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: android.packageName, sha256_cert_fingerprints: android.sha256 } }]);
  });

  return r;
}

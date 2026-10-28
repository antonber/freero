import type { ServerContext } from '../../platform/context';
import { logError } from '../../platform/log';
import { checkRateLimit } from '../../platform/rateLimit';
import type { WsRoute } from '../../platform/ws';
import { onSessionEnd, sessionKeyFromCookieHeader, trackLiveSessions, userFromCookieHeader } from '../auth/index';
import { addSocket, closeAll, closeSession, listen, liveSessionKeys } from './live';

/** /ws/notifications — JSON NotificationsLiveMessage pushes to the signed-in user's open tabs. */
export default function notificationsWs(ctx: ServerContext): WsRoute {
  ctx.onShutdown(listen());
  const stopWatchingSessions = onSessionEnd(closeSession);
  const stopTracking = trackLiveSessions(liveSessionKeys);
  ctx.onShutdown(() => {
    stopWatchingSessions();
    stopTracking();
    closeAll();
  });
  return {
    prefix: '/ws/notifications',
    handle(ws, req) {
      const cookie = req.headers.cookie;
      const sessionKey = sessionKeyFromCookieHeader(cookie);
      void (async () => {
        const user = sessionKey ? await userFromCookieHeader(cookie) : null;
        if (!user || !sessionKey) return ws.close(4401, 'Not logged in');
        if (!(await checkRateLimit('wsConnect', `user:${user.id}`)).allowed) return ws.close(4429, 'Too many connections');
        if (ws.readyState !== ws.OPEN) return;
        addSocket(ws, user.id, sessionKey);
      })().catch((e) => {
        logError('notifications: could not open a socket', e);
        ws.close(1011, 'Could not open notifications');
      });
    },
  };
}

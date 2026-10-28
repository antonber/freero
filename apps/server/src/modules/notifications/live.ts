// Live delivery to open tabs: each instance keeps its own /ws/notifications sockets per user; a
// change is published on one channel (platform/pubsub: Redis across instances, in-process
// otherwise; a publisher receives its own messages), and every instance with a socket of that
// user tells it the new unread count. Ended sessions close their sockets on every instance through
// auth (onSessionEnd runs on each instance, KAI-146).
import type { NotificationsLiveMessage } from '@freero/shared';
import { WebSocket } from 'ws';
import { logError } from '../../platform/log';
import { publish, subscribe } from '../../platform/pubsub';
import * as repo from './repo';

const CHANNEL = 'freero:notifications';

type Message = { type: 'changed'; userId: string } | { type: 'end-session'; sessionKey: string };

interface Sock {
  ws: WebSocket;
  sessionKey: string;
}

const byUser = new Map<string, Set<Sock>>();

const encode = (m: Message) => new TextEncoder().encode(JSON.stringify(m));

/** The user's notifications changed (created, read): their open tabs update, on every instance. */
export function changed(userId: string): void {
  publish(CHANNEL, encode({ type: 'changed', userId }));
}


async function deliver(userId: string): Promise<void> {
  const socks = byUser.get(userId);
  if (!socks?.size) return;
  const msg: NotificationsLiveMessage = { type: 'changed', unread: await repo.unreadCount(userId) };
  const data = JSON.stringify(msg);
  for (const s of socks) if (s.ws.readyState === WebSocket.OPEN) s.ws.send(data);
}

/** A session ended: its notification sockets on THIS instance close (auth calls it on every instance). */
export function closeSession(sessionKey: string): void {
  for (const socks of byUser.values())
    for (const s of socks) if (s.sessionKey === sessionKey) s.ws.close(4401, 'Signed out');
}

/** Starts applying published changes to this instance's sockets; returns the stop function. */
export function listen(): () => void {
  const sub = subscribe(CHANNEL, {
    message(data) {
      try {
        const m = JSON.parse(new TextDecoder().decode(data)) as Message;
        if (m.type === 'changed') deliver(m.userId).catch((e) => logError('notifications: live delivery failed', e));
        else if (m.type === 'end-session') closeSession(m.sessionKey); // from an instance of an older release
      } catch (e) {
        logError('notifications: bad live message', e);
      }
    },
  });
  return sub.close;
}

/** Registers an authenticated socket and sends it the current unread count. */
export function addSocket(ws: WebSocket, userId: string, sessionKey: string): void {
  let socks = byUser.get(userId);
  if (!socks) byUser.set(userId, (socks = new Set()));
  const s = { ws, sessionKey };
  socks.add(s);
  ws.on('close', () => {
    socks.delete(s);
    if (!socks.size && byUser.get(userId) === socks) byUser.delete(userId);
  });
  // Clients only listen; anything they send is ignored.
  ws.on('message', () => {});
  deliver(userId).catch((e) => logError('notifications: live delivery failed', e));
}

/** The sessions behind this instance's sockets (auth re-checks them). */
export function* liveSessionKeys(): Iterable<string> {
  for (const socks of byUser.values()) for (const s of socks) yield s.sessionKey;
}

export function closeAll(): void {
  for (const socks of byUser.values()) for (const s of socks) s.ws.close(1001, 'Server shutting down');
  byUser.clear();
}

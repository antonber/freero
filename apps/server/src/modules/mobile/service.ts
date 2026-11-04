// Push notifications to the phone and tablet apps (#177). A device registers its push token for the
// account and session it is signed in with; modules/notifications hands each new notification to
// `pushToUser` once committed, which sends it to that person's devices that left its type on.
// A device belongs to its session: when the session ends (sign-out, signed out elsewhere, a password
// change, an expired session), its row goes, and a session found gone at send time is dropped too.
import type { MobilePushStatus, NotificationType } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError } from '../../platform/http';
import { logError } from '../../platform/log';
import { userFromSessionKey } from '../auth/index';
import * as repo from './repo';
import { sendApns, sendFcm, type PushMessage, type PushOutcome } from './transports';

const MAX_DEVICES = 20;

export function pushStatus(): MobilePushStatus {
  const { apns, fcm } = getConfig().push;
  return { ios: apns !== null, android: fcm !== null };
}

const TOKEN = /^[A-Za-z0-9:_\-.]{16,4096}$/;

export async function registerDevice(userId: string, sessionKey: string, body: unknown): Promise<{ ok: true }> {
  const b = (body ?? {}) as { platform?: unknown; token?: unknown; off?: unknown };
  if (b.platform !== 'ios' && b.platform !== 'android') throw badRequest('platform must be ios or android');
  if (typeof b.token !== 'string' || !TOKEN.test(b.token)) throw badRequest('token must be the device’s push token');
  if (!pushStatus()[b.platform]) throw new HttpError(404, 'This server doesn’t send push notifications to this kind of device', 'push_unavailable');
  const off = Array.isArray(b.off) ? [...new Set(b.off.filter((t): t is string => typeof t === 'string' && /^[a-z]+\.[a-z_]+$/.test(t)))].slice(0, 50) : [];
  if ((await repo.countOf(userId)) >= MAX_DEVICES) {
    // Too many registered devices: refuse new ones (old ones go with their sessions).
    const mine = await repo.devicesOf(userId);
    if (!mine.some((d) => d.token === b.token)) throw new HttpError(409, `At most ${MAX_DEVICES} devices get push notifications`, 'push_too_many_devices');
  }
  await repo.upsertDevice({ token: b.token, userId, sessionKey, platform: b.platform, offTypes: off }, Date.now());
  return { ok: true };
}

export async function unregisterDevice(userId: string, token: unknown): Promise<{ ok: true }> {
  if (typeof token === 'string') await repo.deleteDevice(userId, token);
  return { ok: true };
}

/** A session ended (on any instance: auth's onSessionEnd): its devices stop getting notifications. */
export function onSessionEnded(sessionKey: string): void {
  void repo.deleteBySession(sessionKey).catch((e) => logError('mobile: could not forget a signed-out device', e));
}

const send = (platform: repo.PushPlatform, token: string, m: PushMessage): Promise<PushOutcome> => {
  const { apns, fcm } = getConfig().push;
  if (platform === 'ios') return apns ? sendApns(apns, token, m) : Promise.resolve('failed');
  return fcm ? sendFcm(fcm, token, m) : Promise.resolve('failed');
};

/**
 * Sends a notification to the person's devices that leave its type on. Devices whose session is
 * gone, and tokens the push service says are dead, are forgotten. Never throws.
 */
export async function pushToUser(userId: string, type: NotificationType, m: PushMessage): Promise<{ sent: number }> {
  let sent = 0;
  try {
    const status = pushStatus();
    if (!status.ios && !status.android) return { sent };
    const forget: string[] = [];
    for (const d of await repo.devicesOf(userId)) {
      if (d.offTypes.includes(type) || !status[d.platform]) continue;
      if ((await userFromSessionKey(d.sessionKey))?.id !== userId) {
        forget.push(d.token);
        continue;
      }
      const outcome = await send(d.platform, d.token, m);
      if (outcome === 'sent') sent++;
      else if (outcome === 'gone') forget.push(d.token);
    }
    await repo.deleteTokens(forget);
  } catch (e) {
    logError('mobile: push notification failed', e);
  }
  return { sent };
}

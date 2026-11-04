// The two push services the apps' devices are reached through (#177), with node's own HTTP/2,
// fetch and crypto — no SDKs:
//   APNs (iOS / iPadOS): HTTP/2 POST /3/device/<token>, authenticated by an ES256 JWT made with the
//     operator's auth key (.p8), renewed every 50 minutes (Apple refuses one older than an hour).
//   FCM HTTP v1 (Android): POST /v1/projects/<id>/messages:send with an OAuth access token the
//     Firebase service account gets for itself (an RS256 JWT bearer grant).
// Each send answers 'sent', 'gone' (the token is dead: the app was removed, the token rotated —
// forget it) or 'failed' (try again with the next notification).
import http2 from 'node:http2';
import { createSign, sign as signWith } from 'node:crypto';
import { logger } from '../../platform/log';

export type PushOutcome = 'sent' | 'gone' | 'failed';
export interface PushMessage {
  title: string;
  /** App path the notification opens ("/board/…?thread=…"). */
  path: string;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const TIMEOUT_MS = 10_000;

// ---- APNs ----

type ApnsConfig = { key: string; keyId: string; teamId: string; topic: string; url: string };
let apnsJwt: { key: string; token: string; at: number } | null = null;

function apnsToken(cfg: ApnsConfig, now = Date.now()): string {
  if (apnsJwt && apnsJwt.key === cfg.keyId && now - apnsJwt.at < 50 * 60_000) return apnsJwt.token;
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: cfg.keyId }));
  const body = b64url(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(now / 1000) }));
  const sig = signWith('sha256', Buffer.from(`${head}.${body}`), { key: cfg.key, dsaEncoding: 'ieee-p1363' });
  apnsJwt = { key: cfg.keyId, token: `${head}.${body}.${b64url(sig)}`, at: now };
  return apnsJwt.token;
}

let session: { url: string; s: http2.ClientHttp2Session } | null = null;
function apnsSession(url: string): http2.ClientHttp2Session {
  if (session && session.url === url && !session.s.closed && !session.s.destroyed) return session.s;
  const s = http2.connect(url);
  s.on('error', () => s.destroy());
  // One idle connection kept: APNs prefers long-lived connections; it is dropped when unused.
  s.setTimeout(5 * 60_000, () => s.close());
  s.unref();
  session = { url, s };
  return s;
}

export function sendApns(cfg: ApnsConfig, token: string, m: PushMessage): Promise<PushOutcome> {
  return new Promise((resolve) => {
    let req: http2.ClientHttp2Stream;
    try {
      req = apnsSession(cfg.url).request({
        ':method': 'POST',
        ':path': `/3/device/${encodeURIComponent(token)}`,
        authorization: `bearer ${apnsToken(cfg)}`,
        'apns-topic': cfg.topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json',
      });
    } catch {
      return resolve('failed');
    }
    let status = 0;
    let text = '';
    req.setTimeout(TIMEOUT_MS, () => req.close(http2.constants.NGHTTP2_CANCEL));
    req.on('response', (h) => (status = Number(h[':status'])));
    req.on('data', (c: Buffer) => (text += c.toString('utf8')));
    req.on('error', () => resolve('failed'));
    req.on('close', () => {
      if (status === 200) return resolve('sent');
      const reason = (() => {
        try {
          return String((JSON.parse(text) as { reason?: unknown }).reason ?? '');
        } catch {
          return '';
        }
      })();
      // 410: no longer active for the topic; 400 BadDeviceToken: not a token of this app / environment.
      if (status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered') return resolve('gone');
      if (status) logger.warn({ push: { apns: status, reason } }, 'push: APNs refused a notification');
      resolve('failed');
    });
    req.end(JSON.stringify({ aps: { alert: { title: m.title }, sound: 'default', 'thread-id': 'freero' }, path: m.path }));
  });
}

// ---- FCM ----

type FcmConfig = { projectId: string; clientEmail: string; privateKey: string; tokenUrl: string; url: string };
let fcmAccess: { email: string; token: string; until: number } | null = null;

async function fcmToken(cfg: FcmConfig, now = Date.now()): Promise<string | null> {
  if (fcmAccess && fcmAccess.email === cfg.clientEmail && fcmAccess.until > now + 60_000) return fcmAccess.token;
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: cfg.clientEmail, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: cfg.tokenUrl, iat, exp: iat + 3600 }));
  const signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(cfg.privateKey);
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${b64url(signature)}` }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  if (!res?.ok) {
    logger.warn({ push: { fcm: 'token', status: res?.status ?? 0 } }, 'push: the Firebase service account got no access token');
    return null;
  }
  const t = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
  if (typeof t.access_token !== 'string') return null;
  fcmAccess = { email: cfg.clientEmail, token: t.access_token, until: now + (Number(t.expires_in) || 3600) * 1000 };
  return fcmAccess.token;
}

export async function sendFcm(cfg: FcmConfig, token: string, m: PushMessage): Promise<PushOutcome> {
  const access = await fcmToken(cfg);
  if (!access) return 'failed';
  const res = await fetch(`${cfg.url}/v1/projects/${encodeURIComponent(cfg.projectId)}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token, notification: { title: m.title }, data: { path: m.path }, android: { priority: 'high' } } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  if (!res) return 'failed';
  if (res.ok) return 'sent';
  const body = (await res.json().catch(() => ({}))) as { error?: { status?: string; details?: Array<{ errorCode?: string }> } };
  const code = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status;
  if (res.status === 404 || code === 'UNREGISTERED') return 'gone';
  if (res.status === 401) fcmAccess = null;
  logger.warn({ push: { fcm: res.status, code } }, 'push: FCM refused a notification');
  return 'failed';
}

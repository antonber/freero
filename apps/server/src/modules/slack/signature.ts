// Slack's request signing, version 0 (docs.slack.dev/authentication/verifying-requests-from-slack):
// HMAC-SHA256 with the app's signing secret over "v0:<X-Slack-Request-Timestamp>:<raw body>", sent
// hex as "v0=<hex>" in X-Slack-Signature. A timestamp more than five minutes from our clock is a
// replay (or a broken clock) and refused before anything is computed; the comparison is constant time.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SLACK_REPLAY_WINDOW_SECONDS = 5 * 60;

export type SlackSignatureCheck = 'ok' | 'unsigned' | 'stale' | 'mismatch';

export function slackSignature(secret: string, timestamp: string, rawBody: Buffer | string): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:`).update(rawBody).digest('hex')}`;
}

export function checkSlackSignature(
  secret: string,
  req: { timestamp: string | undefined; signature: string | undefined; rawBody: Buffer | null },
  nowMs = Date.now(),
): SlackSignatureCheck {
  const { timestamp, signature, rawBody } = req;
  if (!timestamp || !signature || !rawBody) return 'unsigned';
  if (!/^\d{1,12}$/.test(timestamp)) return 'mismatch';
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > SLACK_REPLAY_WINDOW_SECONDS) return 'stale';
  const expected = Buffer.from(slackSignature(secret, timestamp, rawBody), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected) ? 'ok' : 'mismatch';
}

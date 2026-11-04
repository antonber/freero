// Calls to Slack's Web API (docs.slack.dev/apis/web-api), at SLACK_API_URL. Slack answers 200 with
// `ok: false` and an `error` code for most failures, so both are read; a network error or a
// timeout reads as `{ ok: false, error: 'request_failed' }`. Never throws.
import { getConfig } from '../../platform/config';

export interface SlackResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * POSTs to a Web API method. `token`: a bot token, sent as a bearer; null for oauth.v2.access,
 * which authenticates with the app's client id and secret in `form` instead.
 */
export async function callSlack(method: string, token: string | null, body: Record<string, unknown>, opts: { form?: boolean } = {}): Promise<SlackResponse> {
  const slack = getConfig().slack;
  if (!slack) return { ok: false, error: 'not_configured' };
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload: string;
  if (opts.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString();
  } else {
    headers['content-type'] = 'application/json; charset=utf-8';
    payload = JSON.stringify(body);
  }
  try {
    const res = await fetch(`${slack.apiUrl}/${method}`, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(10_000) });
    const json = (await res.json().catch(() => null)) as SlackResponse | null;
    if (!res.ok || !json) return { ok: false, error: json?.error ?? `http_${res.status}` };
    return json;
  } catch {
    return { ok: false, error: 'request_failed' };
  }
}

/** Slack mrkdwn: `&`, `<` and `>` are its only control characters (docs.slack.dev, "Formatting text"). */
export const mrkdwn = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

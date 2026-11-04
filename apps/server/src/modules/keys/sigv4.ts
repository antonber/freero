// AWS Signature Version 4 for the few JSON calls Freero makes to AWS KMS (no SDK for one service:
// the request is a POST of a small JSON body). Follows the published algorithm: canonical request →
// string to sign → signing key HMAC chain (date, region, service, "aws4_request") → signature.
import { createHash, createHmac } from 'node:crypto';

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | null;
}

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const hmac = (key: Buffer | string, s: string) => createHmac('sha256', key).update(s).digest();
/** RFC 3986 encoding as SigV4 wants it (encodeURIComponent leaves !'()* alone). */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** "20150830T123600Z" */
export const amzDate = (at: Date) => at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * The headers to send (the given ones plus x-amz-date, x-amz-security-token and authorization).
 * `headers` must include host; every header given is signed.
 */
export function signRequest(req: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string;
  region: string;
  service: string;
  credentials: AwsCredentials;
  now: Date;
}): Record<string, string> {
  const date = amzDate(req.now);
  const day = date.slice(0, 8);
  const headers: Record<string, string> = { ...req.headers, 'x-amz-date': date };
  if (req.credentials.sessionToken) headers['x-amz-security-token'] = req.credentials.sessionToken;
  const names = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')]));
  const query = [...req.url.searchParams.entries()]
    .map(([k, v]) => [enc(k), enc(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const path = req.url.pathname.split('/').map((p) => enc(decodeURIComponent(p))).join('/') || '/';
  const canonical = [req.method, path, query, ...names.map((n) => `${n}:${lower.get(n)}`), '', names.join(';'), sha256(req.body)].join('\n');
  const scope = `${day}/${req.region}/${req.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', date, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${req.credentials.secretAccessKey}`, day), req.region), req.service), 'aws4_request');
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${req.credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  return headers;
}

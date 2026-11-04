// The Freero plugin for Figma (#172): everything it says to a Freero server. Plain ES module with no
// dependencies, so the plugin's page inlines it (build.mjs) and the server's tests import it as is
// (apps/server/src/integrations/figma.test.ts).
//
// Signing in: a personal access token (Freero → Settings → API tokens), or Freero's OAuth with PKCE.
// A Figma plugin can't receive a redirect, so the plugin registers itself as a public OAuth app
// whose redirect is Freero's /api/integrations/figma/plugin/callback page; that page keeps the
// code under the plugin's secret `state`, and the plugin picks it up and redeems it with its PKCE
// verifier, which never leaves the plugin.

export const SCOPES = 'boards:read boards:write';
export const CALLBACK_PATH = '/api/integrations/figma/plugin/callback';

/** "freero.app" or "https://freero.app/board/x" → "https://freero.app"; null for anything else. */
export function serverOrigin(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) return u.origin;
  } catch {
    // not a URL
  }
  return null;
}

/** The link back to a Figma frame, as Figma writes it ("12:34" → node-id=12-34). */
export function frameLink(fileKey, nodeId) {
  return `https://www.figma.com/design/${fileKey}/?node-id=${String(nodeId).replace(':', '-')}`;
}

/** The file key in a Figma file link (design, file or proto; a branch's key when it names one). */
export function fileKeyOf(link) {
  try {
    const u = new URL(String(link ?? '').trim());
    if (!/(^|\.)figma\.com$/.test(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (!['design', 'file', 'proto'].includes(parts[0])) return null;
    const key = parts[2] === 'branch' && parts[3] ? parts[3] : parts[1];
    return /^[A-Za-z0-9]{10,64}$/.test(key ?? '') ? key : null;
  } catch {
    return null;
  }
}

const b64url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const randomString = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export class FreeroError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function answer(res) {
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON
  }
  if (!res.ok) throw new FreeroError(res.status, body?.error_description ?? body?.error ?? `Freero answered ${res.status}`, body?.code ?? body?.error);
  return body;
}

/**
 * Starts signing in with Freero's OAuth: registers the plugin with the server (once; pass the
 * `clientId` you kept), and makes the state and PKCE pair. Open `authorizeUrl` in the browser
 * (figma.openExternal), then call pickUpSignIn with the result until it returns tokens.
 */
export async function startSignIn(server, { clientId = null, fetchImpl = fetch } = {}) {
  const redirectUri = `${server}${CALLBACK_PATH}`;
  if (!clientId) {
    const reg = await answer(
      await fetchImpl(`${server}/api/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: 'Freero for Figma', client_uri: 'https://freero.app', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
      }),
    );
    clientId = reg.client_id;
  }
  const state = randomString(32);
  const verifier = randomString(48);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256' });
  return { server, clientId, redirectUri, state, verifier, authorizeUrl: `${server}/oauth/authorize?${q}` };
}

const tokensFrom = (t, now = Date.now()) => ({ accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt: t.expires_in ? now + t.expires_in * 1000 : null });

/** Tokens once the person approved in the browser; null while they haven't yet. */
export async function pickUpSignIn(pending, { fetchImpl = fetch } = {}) {
  const got = await answer(
    await fetchImpl(`${pending.server}/api/integrations/figma/plugin/pickup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: pending.state }) }),
  );
  if (!got?.code) return null;
  const form = new URLSearchParams({ grant_type: 'authorization_code', code: got.code, client_id: pending.clientId, redirect_uri: pending.redirectUri, code_verifier: pending.verifier });
  const t = await answer(await fetchImpl(`${pending.server}/api/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() }));
  return { ...tokensFrom(t), clientId: pending.clientId };
}

/**
 * Freero's REST API as the plugin uses it. `auth`: { token } (a personal access token) or the
 * tokens from pickUpSignIn ({ accessToken, refreshToken, clientId }); `onTokens(auth)` is told when
 * an OAuth token was refreshed, to keep the new one.
 */
export class FreeroClient {
  constructor({ server, auth, onTokens = () => undefined, fetchImpl = fetch }) {
    this.server = server;
    this.auth = auth;
    this.onTokens = onTokens;
    this.fetch = fetchImpl;
  }

  bearer() {
    return this.auth.token ?? this.auth.accessToken;
  }

  async refresh() {
    if (!this.auth.refreshToken || !this.auth.clientId) return false;
    const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.auth.refreshToken, client_id: this.auth.clientId });
    const res = await this.fetch(`${this.server}/api/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    if (!res.ok) return false;
    this.auth = { ...this.auth, ...tokensFrom(await res.json()) };
    this.onTokens(this.auth);
    return true;
  }

  async call(method, path, { body, contentType } = {}) {
    const send = () =>
      this.fetch(`${this.server}/api/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.bearer()}`, ...(contentType ? { 'Content-Type': contentType } : {}) },
        body,
      });
    let res = await send();
    if (res.status === 401 && (await this.refresh())) res = await send();
    return answer(res);
  }

  /** Who the credential acts for. */
  me() {
    return this.call('GET', '/me');
  }

  /** Boards the person can open, best matches first for `q`. */
  async boards(q = '') {
    const out = await this.call('GET', `/boards?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    return out.boards ?? [];
  }

  /**
   * Sends one exported frame (PNG bytes) to a board: a new picture, or — with `replace` (the item
   * it made last time) or a `link` to the same frame — the same picture updated in place.
   * Returns { item, replaced }.
   */
  sendPicture(boardId, png, { link, alt, replace } = {}) {
    const q = new URLSearchParams();
    if (link) q.set('link', link);
    if (alt) q.set('alt', alt.slice(0, 500));
    if (replace) q.set('replace', replace);
    return this.call('POST', `/boards/${encodeURIComponent(boardId)}/images${q.size ? `?${q}` : ''}`, { body: png, contentType: 'image/png' });
  }
}

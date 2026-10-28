// Test-only OpenID Connect provider: discovery, JWKS, an authorization endpoint (a tiny sign-in
// form, or a queued sign-in for scripts) and a token endpoint that checks the client secret, the
// redirect URI and the PKCE verifier (S256) and returns an RS256 id token signed with a real key.
// `npm run verify` uses it so the server's real OIDC client runs the full authorization-code + PKCE
// flow; it also runs standalone for driving the UI by hand:
//
//   node scripts/lib/mock-oidc.mjs --port 4252 --client-id freero-dev --client-secret dev-secret
//
// Never use it outside tests: it signs in whoever types an address.

import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** The same address always gets the same subject (a stable provider account id). */
const subjectFor = (email) => `sub-${createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16)}`;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (d) => (s += d));
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}

/**
 * Starts the provider. Returns { issuer, queueSignIn(user), close() }; `user` = { email,
 * emailVerified = true, name?, sub? } or { cancel: true } (the person declines).
 */
export async function startMockOidc({ port = 0, host = '127.0.0.1', clientId, clientSecret }) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'mock-1', alg: 'RS256', use: 'sig' };
  const codes = new Map(); // code -> { clientId, redirectUri, challenge, nonce, user }
  const queued = [];
  let issuer = '';

  const redirect = (res, url) => {
    res.writeHead(302, { location: url });
    res.end();
  };
  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  function finish(res, params, user) {
    const back = new URL(params.redirect_uri);
    if (params.state) back.searchParams.set('state', params.state);
    if (user.cancel) {
      back.searchParams.set('error', 'access_denied');
      return redirect(res, back.href);
    }
    const code = b64url(randomBytes(24));
    codes.set(code, {
      clientId: params.client_id,
      redirectUri: params.redirect_uri,
      challenge: params.code_challenge,
      nonce: params.nonce,
      user: { emailVerified: true, ...user },
      expires: Date.now() + 60_000,
    });
    back.searchParams.set('code', code);
    redirect(res, back.href);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, issuer);
      if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
        return json(res, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
          scopes_supported: ['openid', 'email', 'profile'],
        });
      }
      if (req.method === 'GET' && url.pathname === '/jwks') return json(res, 200, { keys: [jwk] });

      if (url.pathname === '/authorize') {
        const params =
          req.method === 'POST' ? Object.fromEntries(new URLSearchParams(await readBody(req))) : Object.fromEntries(url.searchParams);
        if (params.client_id !== clientId) return json(res, 400, { error: 'unauthorized_client' });
        if (params.response_type !== 'code' || !params.redirect_uri) return json(res, 400, { error: 'invalid_request' });
        if (params.code_challenge_method !== 'S256' || !params.code_challenge) return json(res, 400, { error: 'invalid_request', error_description: 'PKCE S256 required' });
        if (req.method === 'POST') {
          if (params.decision === 'cancel') return finish(res, params, { cancel: true });
          const email = String(params.email ?? '').trim();
          return finish(res, params, { email, name: params.name || undefined, emailVerified: params.verified === 'on', sub: params.sub || undefined });
        }
        if (queued.length) return finish(res, params, queued.shift());
        const hidden = ['client_id', 'response_type', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'nonce', 'scope']
          .map((k) => `<input type="hidden" name="${k}" value="${escapeHtml(params[k] ?? '')}">`)
          .join('');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><meta charset="utf-8"><title>Test identity provider</title>
<style>body{font:15px system-ui;max-width:360px;margin:60px auto;color:#222}label{display:block;margin:12px 0 4px}input[type=email],input[type=text]{width:100%;padding:8px;box-sizing:border-box}button{margin-top:16px;padding:8px 14px}</style>
<h1>Test identity provider</h1><p>Local testing only. Sign in as:</p>
<form method="post" action="/authorize">${hidden}
<label>Email<input type="email" name="email" value="${escapeHtml(params.login_hint ?? '')}" required></label>
<label>Name<input type="text" name="name"></label>
<label><input type="checkbox" name="verified" checked> Email verified</label>
<button type="submit" name="decision" value="allow">Sign in</button>
<button type="submit" name="decision" value="cancel" formnovalidate>Cancel</button>
</form>`);
      }

      if (req.method === 'POST' && url.pathname === '/token') {
        const body = Object.fromEntries(new URLSearchParams(await readBody(req)));
        let id = body.client_id;
        let secret = body.client_secret;
        const basic = /^Basic (.+)$/i.exec(req.headers.authorization ?? '');
        if (basic) [id, secret] = Buffer.from(basic[1], 'base64').toString().split(':').map(decodeURIComponent);
        if (id !== clientId || secret !== clientSecret) return json(res, 401, { error: 'invalid_client' });
        if (body.grant_type !== 'authorization_code') return json(res, 400, { error: 'unsupported_grant_type' });
        const grant = codes.get(body.code);
        codes.delete(body.code); // single use
        if (!grant || grant.expires < Date.now() || grant.clientId !== id) return json(res, 400, { error: 'invalid_grant' });
        if (body.redirect_uri !== grant.redirectUri) return json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
        const challenge = b64url(createHash('sha256').update(String(body.code_verifier ?? '')).digest());
        if (challenge !== grant.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
        const u = grant.user;
        const idToken = await new SignJWT({
          nonce: grant.nonce,
          email: u.email,
          email_verified: u.emailVerified,
          ...(u.name ? { name: u.name } : {}),
        })
          .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
          .setIssuer(issuer)
          .setAudience(clientId)
          .setSubject(u.sub ?? subjectFor(u.email))
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(privateKey);
        return json(res, 200, { access_token: b64url(randomBytes(24)), token_type: 'Bearer', expires_in: 300, id_token: idToken });
      }
      json(res, 404, { error: 'not_found' });
    } catch (e) {
      json(res, 500, { error: 'server_error', error_description: String(e?.message ?? e) });
    }
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  issuer = `http://${host}:${server.address().port}`;
  return {
    issuer,
    queueSignIn: (user) => queued.push(user),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// Standalone: node scripts/lib/mock-oidc.mjs --port 4252 --client-id x --client-secret y
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : def;
  };
  const p = await startMockOidc({
    port: Number(arg('port', '4252')),
    clientId: arg('client-id', 'freero-dev'),
    clientSecret: arg('client-secret', 'dev-secret'),
  });
  console.log(`mock OIDC provider at ${p.issuer}`);
}

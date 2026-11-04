// Sign-in: OAuth 2.0 (authorization code with PKCE) against Freero's own OAuth server, at
// freero.app unless the person names their own Freero. The hosted app's client id and secret are
// the Zapier app's environment (CLIENT_ID, CLIENT_SECRET: an OAuth app registered on freero.app);
// for another Freero server, the person registers an OAuth app there and gives its id and secret.
'use strict';

const { baseUrl, DEFAULT_BASE_URL } = require('./lib/freero');

const SCOPES = 'boards:read boards:write comments:write webhooks:manage';

const clientOf = (bundle) => {
  const own = bundle.inputData && bundle.inputData.clientId;
  return own
    ? { id: String(own).trim(), secret: String(bundle.inputData.clientSecret || '').trim() }
    : { id: process.env.CLIENT_ID, secret: process.env.CLIENT_SECRET };
};

/** The token endpoint's answer, as Zapier keeps it (Freero's refresh tokens rotate: the new one replaces the old). */
const tokens = (r, bundle) => ({
  access_token: r.data.access_token,
  refresh_token: r.data.refresh_token,
  baseUrl: baseUrl(bundle),
});

const tokenRequest = (z, bundle, body) => {
  const client = clientOf(bundle);
  return z
    .request({
      url: `${baseUrl(bundle)}/api/oauth/token`,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: { ...body, client_id: client.id, ...(client.secret ? { client_secret: client.secret } : {}) },
    })
    .then((r) => tokens(r, bundle));
};

module.exports = {
  type: 'oauth2',
  fields: [
    {
      key: 'baseUrl',
      label: 'Freero address',
      required: false,
      default: DEFAULT_BASE_URL,
      helpText: `Leave it as ${DEFAULT_BASE_URL}, or give your own Freero server's address (https).`,
    },
    {
      key: 'clientId',
      label: 'OAuth app client ID (your own Freero server only)',
      required: false,
      helpText: 'Only when Freero isn’t freero.app: on your Freero, Settings → Your OAuth apps → register an app with Confidential app on and the redirect address of this Zapier app (see Freero’s Zapier guide).',
    },
    { key: 'clientSecret', label: 'OAuth app client secret (your own Freero server only)', type: 'password', required: false },
  ],
  oauth2Config: {
    authorizeUrl: (z, bundle) => {
      const u = new URL(`${baseUrl(bundle)}/oauth/authorize`);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('client_id', clientOf(bundle).id || '');
      u.searchParams.set('redirect_uri', bundle.inputData.redirect_uri);
      u.searchParams.set('state', bundle.inputData.state);
      u.searchParams.set('scope', SCOPES);
      return u.toString();
    },
    getAccessToken: (z, bundle) =>
      tokenRequest(z, bundle, {
        grant_type: 'authorization_code',
        code: bundle.inputData.code,
        redirect_uri: bundle.inputData.redirect_uri,
        ...(bundle.inputData.code_verifier ? { code_verifier: bundle.inputData.code_verifier } : {}),
      }),
    refreshAccessToken: (z, bundle) => tokenRequest(z, { ...bundle, inputData: { ...bundle.authData, ...bundle.inputData } }, { grant_type: 'refresh_token', refresh_token: bundle.authData.refresh_token }),
    autoRefresh: true,
    enablePkce: true,
    scope: SCOPES,
  },
  test: (z, bundle) => z.request({ url: `${baseUrl(bundle)}/api/v1/me` }).then((r) => r.data),
  connectionLabel: (z, bundle) => {
    const user = (bundle.inputData && bundle.inputData.user) || {};
    return `${user.name || user.email || 'Freero'} (${new URL(baseUrl(bundle)).host})`;
  },
};

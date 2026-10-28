// A generic OpenID Connect relying party (openid-client): authorization code flow with PKCE (S256),
// state and nonce, id-token validation against the issuer's JWKS. Any issuer works — Google,
// Microsoft (multi-tenant: openid-client checks each tenant's issuer), and per-workspace SSO
// later — given its issuer URL, client id and secret. Nothing here knows about Freero accounts.
import * as client from 'openid-client';

export interface OidcClientConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Boolean claims that also mean "the provider vouches for this email" (besides email_verified). */
  verifiedEmailClaims?: readonly string[];
}

/** What the provider asserts about the person who signed in (from the validated id token). */
export interface ProviderClaims {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

/** The provider could not be reached or its discovery document is unusable. */
export class OidcUnavailableError extends Error {}

const configurations = new Map<string, Promise<client.Configuration>>();

/** Discovery once per issuer + client (retried after a failure). */
function configuration(cfg: OidcClientConfig): Promise<client.Configuration> {
  const key = `${cfg.issuer}\n${cfg.clientId}`;
  let found = configurations.get(key);
  if (!found) {
    const issuer = new URL(cfg.issuer);
    // http issuers pass config validation only outside production (local test providers).
    const options = issuer.protocol === 'http:' ? { execute: [client.allowInsecureRequests] } : undefined;
    found = client.discovery(issuer, cfg.clientId, cfg.clientSecret, undefined, options).catch((e: unknown) => {
      configurations.delete(key);
      throw new OidcUnavailableError(e instanceof Error ? e.message : String(e));
    });
    configurations.set(key, found);
  }
  return found;
}

/** One authorization request's secrets, kept server-side until the callback. */
export interface AuthorizationChecks {
  state: string;
  nonce: string;
  codeVerifier: string;
}

export function newAuthorizationChecks(): AuthorizationChecks {
  return { state: client.randomState(), nonce: client.randomNonce(), codeVerifier: client.randomPKCECodeVerifier() };
}

/** Where to send the browser to sign in at the provider. */
export async function authorizationUrl(cfg: OidcClientConfig, redirectUri: string, checks: AuthorizationChecks): Promise<string> {
  const config = await configuration(cfg);
  return client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    state: checks.state,
    nonce: checks.nonce,
    code_challenge: await client.calculatePKCECodeChallenge(checks.codeVerifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).href;
}

/**
 * Redeems the authorization code the provider redirected back with (`callbackUrl`: the registered
 * redirect URI plus the query the provider added) and returns the validated id token's claims.
 * Throws when anything does not check out (state, PKCE, nonce, signature, issuer, audience, expiry).
 */
export async function redeemAuthorizationCode(
  cfg: OidcClientConfig,
  callbackUrl: URL,
  checks: AuthorizationChecks,
): Promise<ProviderClaims> {
  const config = await configuration(cfg);
  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: checks.codeVerifier,
    expectedState: checks.state,
    expectedNonce: checks.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims) throw new Error('the provider returned no id token');
  const email = typeof claims.email === 'string' && claims.email ? claims.email : null;
  const vouched = claims.email_verified === true || (cfg.verifiedEmailClaims ?? []).some((c) => claims[c] === true);
  return {
    issuer: claims.iss,
    subject: claims.sub,
    email,
    emailVerified: email !== null && vouched,
    name: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : null,
  };
}

// Redirect URIs an OAuth client may register and how a request's redirect_uri is matched against
// them — one set of rules for every client: registered in settings, self-registered (RFC 7591) or
// described by a client metadata document (#81).

const MAX_REDIRECTS = 10;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const UNSAFE_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:', 'ws:', 'wss:', 'ftp:']);

/**
 * A redirect URI an app may register: https anywhere, http only on loopback (native apps, RFC
 * 8252 §7.3), or an app's own scheme (`vscode://…`, `cursor://…`, §7.1) — never a scheme that
 * runs code, and never with a fragment. Null when it is not acceptable.
 */
export function cleanRedirectUri(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.hash || raw.includes('#') || u.username || u.password) return null;
  if (u.protocol === 'https:') return raw;
  if (u.protocol === 'http:') return LOOPBACK.has(u.hostname) ? raw : null;
  if (UNSAFE_SCHEMES.has(u.protocol) || !/^[a-z][a-z0-9+.-]*:$/.test(u.protocol)) return null;
  return raw;
}

/** Exact match, except that a loopback http URI matches on any port (RFC 8252 §7.3). */
export function redirectMatches(registered: readonly string[], given: string): boolean {
  if (registered.includes(given)) return true;
  let g: URL;
  try {
    g = new URL(given);
  } catch {
    return false;
  }
  if (g.protocol !== 'http:' || !LOOPBACK.has(g.hostname)) return false;
  return registered.some((r) => {
    const u = new URL(r);
    return u.protocol === 'http:' && u.hostname === g.hostname && u.pathname === g.pathname && u.search === g.search;
  });
}

/** A client's whole list, each checked (`err` words the refusal for the caller's protocol). */
export function cleanRedirects(v: unknown, err: (m: string) => Error): string[] {
  if (!Array.isArray(v) || !v.length) throw err('Register at least one redirect URI');
  if (v.length > MAX_REDIRECTS) throw err(`At most ${MAX_REDIRECTS} redirect URIs`);
  return v.map((r) => {
    const clean = cleanRedirectUri(r);
    if (!clean) throw err(`Redirect URI not allowed: ${String(r).slice(0, 200)} (https, http on localhost, or an app's own scheme; no fragment)`);
    return clean;
  });
}

// Who may create an account on this server (#64, for self-hosters): SIGNUPS=open (default) or
// invite-only. Invite-only lets in an address that something on this server expects: modules
// register a check here (members and workspaces: a live invite to that address; sso: a verified
// domain whose workspace adds new sign-ups), plus SIGNUP_DOMAINS and the operators' own addresses.
// Asked by the two ways a person makes their own account — signup with a password and a first
// sign-in with a personal provider. Accounts the organization's identity provider or directory makes
// (SSO just in time, SCIM) are vouched for by a workspace that proved the domain, so they pass.
import { getConfig } from '../../platform/config';
import { HttpError } from '../../platform/http';
import { logError } from '../../platform/log';

export const SIGNUP_CLOSED = 'signup_closed';

type ExpectedCheck = (email: string) => Promise<boolean> | boolean;
const checks = new Set<ExpectedCheck>();

/** Registers "this address may sign up even on an invite-only server" (a pending invite…). */
export function onSignupExpected(fn: ExpectedCheck): () => void {
  checks.add(fn);
  return () => checks.delete(fn);
}

/** Null when `email` may create an account here; else why not. */
export async function signupRefusal(email: string): Promise<string | null> {
  const { signups, operatorEmails } = getConfig();
  if (signups.mode === 'open') return null;
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  if (signups.allowedDomains.includes(domain) || operatorEmails.includes(email.toLowerCase())) return null;
  for (const fn of checks) {
    try {
      if (await fn(email)) return null;
    } catch (e) {
      logError('auth: a sign-up check failed', e);
    }
  }
  return 'New accounts on this Freero server are by invitation. Ask someone here to invite this address to a board or workspace, then sign up with it.';
}

export async function assertSignupAllowed(email: string): Promise<void> {
  const why = await signupRefusal(email);
  if (why) throw new HttpError(403, why, SIGNUP_CLOSED);
}

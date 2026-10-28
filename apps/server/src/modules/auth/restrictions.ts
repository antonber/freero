// Policy seam: another module may refuse a way of signing in for some accounts. Workspace single
// sign-on (modules/sso) registers here: with "Enforce SSO" on, an address at the workspace's
// verified domain signs in only through the workspace's identity provider (except its break-glass
// owner). Every way in asks — signup, password, reset and "this wasn't me" links, personal
// providers (completeSignIn), and a provider sign-in before it may create an account — so no path
// skips it.
import { SSO_REQUIRED } from '@freero/shared';
import { HttpError } from '../../platform/http';
import { logError } from '../../platform/log';

export interface SignInAttempt {
  /** The address the person signs in or up with (normalized). */
  email: string;
  /** Their account, when one exists. */
  userId: string | null;
  /** 'password', 'email_link', a provider id ('google'), or 'sso:<workspaceId>'. */
  method: string;
}

/** Why this way in is refused, and where to go instead. */
export interface SignInRestriction {
  message: string;
  /** Where the browser should go to sign in (the workspace's SSO start). */
  ssoUrl: string;
}

type RestrictionCheck = (attempt: SignInAttempt) => Promise<SignInRestriction | null> | SignInRestriction | null;
const checks = new Set<RestrictionCheck>();

export function onSignInRestriction(fn: RestrictionCheck): () => void {
  checks.add(fn);
  return () => checks.delete(fn);
}

/** The first restriction that refuses this attempt, or null. A failing check refuses (fail closed). */
export async function signInRestriction(attempt: SignInAttempt): Promise<SignInRestriction | null> {
  for (const fn of checks) {
    try {
      const r = await fn(attempt);
      if (r) return r;
    } catch (e) {
      logError('auth: a sign-in restriction check failed; refusing the sign-in', e);
      return { message: 'Signing in is unavailable right now. Please try again in a moment.', ssoUrl: '/login' };
    }
  }
  return null;
}

export class SignInRestrictedError extends HttpError {
  constructor(readonly restriction: SignInRestriction) {
    super(403, restriction.message, SSO_REQUIRED);
  }
}

/** Throws 403 { code: 'sso_required' } when a restriction refuses the attempt. */
export async function assertSignInAllowed(attempt: SignInAttempt): Promise<void> {
  const r = await signInRestriction(attempt);
  if (r) throw new SignInRestrictedError(r);
}

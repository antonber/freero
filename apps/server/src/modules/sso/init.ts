import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { onEmailVerified, onSessionStarted, onSignInRestriction, onSignOutRedirect, onSignupExpected } from '../auth/index';
import { onTeamWorkspaceCreation } from '../workspaces/index';
import { captureVerifiedAddress, completeDueCaptures, joinsOnSignup, teamWorkspaceCreationCheck } from './domainControl';
import { recordSamlSession, samlSignOutRedirect } from './logout';
import { enforcedSsoRestriction } from './policy';
import * as repo from './repo';

const CLEANUP_LOCK_KEY = 7_202_610_303; // arbitrary, constant across releases (7_202_610_301 is auth:two-factor-recovery's)
const CAPTURE_LOCK_KEY = 7_202_611_231;

export default function initSso(ctx: ServerContext): void {
  // "Enforce SSO": every way of signing in asks auth, auth asks here.
  const stop = onSignInRestriction(enforcedSsoRestriction);
  ctx.onShutdown(() => void stop());
  // Domain control (#64): new verified addresses at a domain that adds sign-ups join its workspace;
  // a domain that blocks other team workspaces refuses them; grace periods that are over complete.
  const stopCapture = onEmailVerified(captureVerifiedAddress);
  const stopBlock = onTeamWorkspaceCreation(teamWorkspaceCreationCheck);
  // On an invite-only server, an address at such a domain may sign up: it joins that workspace.
  const stopExpected = onSignupExpected(joinsOnSignup);
  // Single logout (#13): which sessions a SAML sign-in started, and the IdP's logout after ours.
  const stopSessions = onSessionStarted(recordSamlSession);
  const stopSignOut = onSignOutRedirect(samlSignOutRedirect);
  ctx.onShutdown(() => {
    stopSessions();
    stopSignOut();
    stopCapture();
    stopBlock();
    stopExpected();
  });
  scheduleExclusiveJob(ctx, {
    name: 'sso:domain-capture',
    lockKey: CAPTURE_LOCK_KEY,
    intervalMs: 10 * 60_000,
    run: async () => void (await completeDueCaptures()),
  });
  // Sign-ins nobody finished, requests nobody answered, assertion IDs past their validity.
  scheduleExclusiveJob(ctx, {
    name: 'sso:cleanup',
    lockKey: CLEANUP_LOCK_KEY,
    intervalMs: 15 * 60_000,
    run: () => repo.deleteExpired(Date.now()),
  });
}

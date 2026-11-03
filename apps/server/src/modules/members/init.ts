import type { ServerContext } from '../../platform/context';
import { onEmailVerified, onSignupExpected } from '../auth/index';
import { convertInvitesFor } from './invites';
import { hasLiveInviteFor } from './repo';

export default function initMembers(ctx: ServerContext): void {
  // Someone proved an address (verification link, password reset, email change): the pending
  // invites sent to it become memberships.
  const stop = onEmailVerified(convertInvitesFor);
  ctx.onShutdown(() => void stop());
  // An invite-only server lets an invited address sign up.
  const stopExpected = onSignupExpected((email) => hasLiveInviteFor(email, Date.now()));
  ctx.onShutdown(() => void stopExpected());
}

import type { ServerContext } from '../../platform/context';
import { onEmailVerified } from '../auth/index';
import { convertInvitesFor } from './invites';

export default function initMembers(ctx: ServerContext): void {
  // Someone proved an address (verification link, password reset, email change): the pending
  // invites sent to it become memberships.
  const stop = onEmailVerified(convertInvitesFor);
  ctx.onShutdown(() => void stop());
}

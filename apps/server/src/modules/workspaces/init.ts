import type { ServerContext } from '../../platform/context';
import { onEmailVerified } from '../auth/index';
import { convertInvitesFor } from './invites';

export default function initWorkspaces(ctx: ServerContext): void {
  // Someone proved an address: the pending workspace invites sent to it become memberships.
  const stop = onEmailVerified(convertInvitesFor);
  ctx.onShutdown(() => void stop());
}

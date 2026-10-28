import type { ServerContext } from '../../platform/context';
import { onSsoJoin } from '../sso/index';
import * as repo from './repo';

export default function initScim(ctx: ServerContext): void {
  // Someone the directory deactivated stays out: SSO just-in-time sign-in doesn't bring them back.
  const stop = onSsoJoin(async (workspaceId, userId) => {
    const su = await repo.getUser(workspaceId, userId);
    return su && !su.active ? 'deactivated by the organization’s directory (SCIM)' : null;
  });
  ctx.onShutdown(() => void stop());
}

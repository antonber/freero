import type { ServerContext } from '../../platform/context';
import { onMembershipChanged } from '../workspaces/index';
import { unshareOnLeave } from './service';

/** A template shared with a team stops being shared there when its owner leaves (or becomes a guest). */
export default function templatesInit(ctx: ServerContext): void {
  const stop = onMembershipChanged((e) => unshareOnLeave(e.workspaceId, e.userId, e.role));
  ctx.onShutdown(() => void stop());
}

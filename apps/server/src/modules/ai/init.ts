import type { ServerContext } from '../../platform/context';
import { consumeOutbox } from '../../platform/outbox';
import { unshareWorkflowsOnLeave } from './workflows';

/**
 * A saved AI workflow shared with a team stops being shared there when its owner leaves (or
 * becomes a guest) — from the workspaces' outbox events, so a crash right after the membership
 * change can't leave it shared (#1).
 */
export default function aiInit(ctx: ServerContext): void {
  consumeOutbox(ctx, unshareWorkflowsOnLeave);
}

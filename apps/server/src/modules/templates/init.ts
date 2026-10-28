import type { ServerContext } from '../../platform/context';
import { consumeOutbox } from '../../platform/outbox';
import { registerTemplateObjectType } from './objects';
import { unshareOnLeaveConsumer } from './service';

/**
 * Templates are objects of the registry; and a template shared with a team stops being shared
 * there when its owner leaves (or becomes a guest) — from the workspaces' outbox events, so a
 * crash right after the membership change can't leave it shared.
 */
export default function templatesInit(ctx: ServerContext): void {
  registerTemplateObjectType();
  consumeOutbox(ctx, unshareOnLeaveConsumer);
}

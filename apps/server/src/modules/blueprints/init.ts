import type { ServerContext } from '../../platform/context';
import { consumeOutbox } from '../../platform/outbox';
import { unshareOnLeaveConsumer } from './service';

/** A blueprint shared with a team stops being shared there when its owner leaves it (or becomes a guest). */
export default function blueprintsInit(ctx: ServerContext): void {
  consumeOutbox(ctx, unshareOnLeaveConsumer);
}

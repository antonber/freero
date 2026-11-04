// The sensitive-data scan (#158): boards are scanned again from the outbox (a saved change of their
// shared content, a move, a restore), one instance at a time like search; and while a board holds
// findings in a workspace that requires a label for them, its label can't be lowered.
import type { ServerContext } from '../../platform/context';
import { consumeOutbox } from '../../platform/outbox';
import { onLabelChange } from '../boards/index';
import { dlpConsumer, guardLabelChange } from './service';

export default function initDlp(ctx: ServerContext): void {
  consumeOutbox(ctx, dlpConsumer);
  const stop = onLabelChange(guardLabelChange);
  ctx.onShutdown(async () => void stop());
}

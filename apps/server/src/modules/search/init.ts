// Keeps the search index up to date: every saved change of a board's shared content raises a
// `board.content` outbox event (realtime), every rename a board event (boards) — both in the
// change's own transaction; this consumer re-derives that board, on one instance at a time,
// resuming where it stopped (platform/outbox.ts).
import type { ServerContext } from '../../platform/context';
import { consumeOutbox } from '../../platform/outbox';
import { searchConsumer } from './service';

export default function initSearch(ctx: ServerContext): void {
  consumeOutbox(ctx, searchConsumer);
}

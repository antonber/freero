// Keeps the references index up to date: every saved change of a board's content raises a
// `board.content` outbox event (realtime, same transaction); this consumer re-derives that board.
// It runs on one instance at a time and resumes where it stopped (platform/outbox.ts).
import type { ServerContext } from '../../platform/context';
import { consumeOutbox } from '../../platform/outbox';
import { referencesConsumer } from './service';

export default function initReferences(ctx: ServerContext): void {
  consumeOutbox(ctx, referencesConsumer);
}

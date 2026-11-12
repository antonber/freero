// PostHog product analytics (POSTHOG_KEY): the client starts here, and a graceful shutdown sends
// the events still queued before the database closes (at most 5 s; see productEvents.ts). Ongoing
// use (items, comments, proposals, doc edits; usage.ts) is counted from realtime's change streams.
import type { ServerContext } from '../../platform/context';
import { startProductAnalytics, stopProductAnalytics } from './productEvents';
import { startUsageCounting } from './usage';

export default function init(ctx: ServerContext): void {
  if (!ctx.config.posthog) return;
  startProductAnalytics(ctx.config);
  ctx.onShutdown(() => stopProductAnalytics());
  // After the client's hook, so it runs before it (last registered first): its last window goes out.
  startUsageCounting(ctx);
}

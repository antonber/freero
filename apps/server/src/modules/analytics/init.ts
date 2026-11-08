// PostHog product analytics (POSTHOG_KEY): the client starts here, and a graceful shutdown sends
// the events still queued before the database closes (at most 5 s; see productEvents.ts).
import type { ServerContext } from '../../platform/context';
import { startProductAnalytics, stopProductAnalytics } from './productEvents';

export default function init(ctx: ServerContext): void {
  if (!ctx.config.posthog) return;
  startProductAnalytics(ctx.config);
  ctx.onShutdown(() => stopProductAnalytics());
}

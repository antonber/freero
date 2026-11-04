import type { ServerContext } from '../../platform/context';
import { onSessionEnd } from '../auth/index';
import { onSessionEnded } from './service';

/** A device's push registration ends with the session it was made in (#177), on every instance. */
export default function initMobile(ctx: ServerContext): void {
  ctx.onShutdown(onSessionEnd(onSessionEnded));
}

import type { ServerContext } from '../../platform/context';
import { registerWalkthroughObjects } from './objects';

/** Walkthroughs join the object registry (`freero://walkthrough/<id>`). */
export default function initWalkthroughs(_ctx: ServerContext): void {
  registerWalkthroughObjects();
}

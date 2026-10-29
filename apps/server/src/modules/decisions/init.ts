import type { ServerContext } from '../../platform/context';
import { registerDecisionObjects } from './objects';

/** Decisions join the object registry (`freero://decision/<id>`). */
export default function initDecisions(_ctx: ServerContext): void {
  registerDecisionObjects();
}

// Loads the features' outline declarations before the server listens: a broken outline.ts (or a
// type described twice) stops startup instead of failing the first request.
import type { ServerContext } from '../../platform/context';
import { log } from '../../platform/log';
import { outlineFeatures } from './features';

export default async function initOutline(_ctx: ServerContext): Promise<void> {
  const features = await outlineFeatures();
  log(`outline: ${features.length} feature outline declarations`);
}

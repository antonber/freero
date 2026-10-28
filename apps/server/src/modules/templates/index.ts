// Public API of modules/templates [S2]: saved templates (a board or selection saved for reuse).
// Only its own routes use it today; workspaces (KAI-37) will share templates per workspace by
// widening the visibility rule in repo.ts.
import { UPLOAD_REF_PATTERN } from '../uploads/index';
import * as repo from './repo';

export { listTemplates, getTemplate } from './service';

/**
 * Upload names saved templates reference (images in their content, their thumbnails), restricted
 * to `among` when given. A template outlives the board it came from, so these files must too.
 */
export function templateUploadReferences(among?: readonly string[]): Promise<string[]> {
  return repo.matchesInTemplates(UPLOAD_REF_PATTERN, among ?? null);
}

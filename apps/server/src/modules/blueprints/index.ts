// Public API of modules/blueprints [S2] (#161): reusable setups of a project's boards and docs.
import { UPLOAD_REF_PATTERN } from '../uploads/index';
import * as repo from './repo';

export { listBlueprints, useBlueprint } from './service';

/** Upload names blueprints' content references: a blueprint outlives the boards it came from, so its images must too. */
export function blueprintUploadReferences(among?: readonly string[]): Promise<string[]> {
  return repo.matchesInItems(UPLOAD_REF_PATTERN, among ?? null);
}

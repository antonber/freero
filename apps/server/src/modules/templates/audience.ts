// Who a template reaches (#155): the team workspaces someone is a full member of, and the
// organisations those workspaces belong to (company templates). Asked of modules/workspaces, so
// this module never reads another module's tables.
import { organisationsOfWorkspaces, teamWorkspaceIdsFor } from '../workspaces/index';
import type { Audience } from './repo';

export async function audienceOf(userId: string): Promise<Audience> {
  const workspaceIds = await teamWorkspaceIdsFor(userId);
  const organisationIds = [...new Set((await organisationsOfWorkspaces(workspaceIds)).values())];
  return { workspaceIds, organisationIds };
}

// Saved templates as objects of the registry (modules/objects, KAI-147): visible exactly as the
// template list shows them (repo.ts's VISIBLE_TO_USER: your own, and those shared with a team you
// are a full member of); only the owner manages one. Guests have no templates.
import { isGuestId, objectKey, type ObjectAction, type ObjectRef } from '@freero/shared';
import { registerObjectType, type ObjectLookup, type ObjectTypeHandler } from '../objects/index';
import { teamWorkspaceIdsFor } from '../workspaces/index';
import * as repo from './repo';

export const templateObjects: ObjectTypeHandler = {
  type: 'template',
  async lookup(actor, refs) {
    const out = new Map<string, ObjectLookup>();
    if (isGuestId(actor.userId)) return out;
    const ids = refs.filter((r): r is Extract<ObjectRef, { type: 'template' }> => r.type === 'template').map((r) => r.id);
    if (!ids.length) return out;
    const visible = await repo.visibleAmong(ids, actor.userId, await teamWorkspaceIdsFor(actor.userId));
    for (const t of visible) {
      const access: ObjectAction = t.ownerId === actor.userId ? 'manage' : 'view';
      out.set(objectKey({ type: 'template', id: t.id }), {
        access,
        summary: { type: 'template', title: t.name, text: t.description || undefined, image: t.thumbnail, path: null, access },
      });
    }
    return out;
  },
};

/** Templates join the object registry (init.ts; tests call it too). */
export function registerTemplateObjectType(): void {
  registerObjectType(templateObjects);
}

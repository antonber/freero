// Who presents a board (#146). The slides follow the presenter's presence (features/present); WHO
// may present is kept here, in the server-written `presentation` collection, so a handoff is a
// checked change of state: only the presenter, the session's facilitator or the board's owner hand
// presenting over, and only to someone on the board now.
import {
  FACILITATION_COLLECTION,
  PRESENTATION_COLLECTION,
  guestDisplayName,
  type FacilitationSession,
  type PresentationSession,
  type Role,
} from '@freero/shared';
import { badRequest, forbidden, HttpError } from '../../platform/http';
import type { Actor } from '../auth/index';
import { actorId } from '../auth/index';
import { requireBoardAccess } from '../boards/index';
import { readBoardView, updateServerEntry } from '../realtime/index';

const KEY = 'session';

interface Who {
  id: string;
  name: string;
  role: Role;
  /** The facilitator of a running facilitation session. */
  facilitates: boolean;
}

/** May `who` take over or end the presentation `current` (null: yes)? Pure, for the rules below. */
export function controlRefusal(current: PresentationSession | undefined, who: Who, peopleHere: ReadonlyMap<string, string>): string | null {
  if (!current || current.presenterId === who.id || who.facilitates || who.role === 'owner') return null;
  // A presenter who left the board no longer holds it.
  if (!peopleHere.has(current.presenterId)) return null;
  return `${current.presenterName || 'Someone'} is presenting`;
}

const cleanFrame = (v: unknown): string | null => (typeof v === 'string' && v.length <= 64 ? v : null);

export async function present(boardId: string, actor: Actor, body: Record<string, unknown>, now = Date.now()): Promise<PresentationSession | null> {
  const id = actorId(actor);
  const { role } = await requireBoardAccess(boardId, id);
  const view = await readBoardView(boardId, { userId: id, role });
  const facilitation = view.collection(FACILITATION_COLLECTION).get('session') as FacilitationSession | undefined;
  const who: Who = {
    id,
    name: actor.kind === 'user' ? actor.user.name : guestDisplayName(actor.guest.name),
    role,
    facilitates: facilitation?.by === id,
  };
  const action = body.action;
  const result = await updateServerEntry<PresentationSession>(boardId, PRESENTATION_COLLECTION, KEY, (current, here) => {
    switch (action) {
      case 'start': {
        const why = controlRefusal(current, who, here);
        if (why) throw new HttpError(409, why, 'presenting');
        return { presenterId: who.id, presenterName: who.name, at: now, frameId: cleanFrame(body.frameId) };
      }
      case 'handoff': {
        if (!current) throw new HttpError(409, 'Nobody is presenting', 'not_presenting');
        if (current.presenterId !== who.id && !who.facilitates && who.role !== 'owner') throw forbidden('Only the presenter, the facilitator or the board’s owner hands over');
        const to = typeof body.to === 'string' ? body.to : '';
        if (!to || to === current.presenterId) throw badRequest('Pick someone else to present');
        if (!here.has(to)) throw new HttpError(409, 'They aren’t on the board now', 'not_here');
        return {
          presenterId: to,
          presenterName: here.get(to) || 'Someone',
          at: now,
          frameId: cleanFrame(body.frameId) ?? current.frameId,
          handedBy: who.name,
          handedFrom: current.presenterId,
        };
      }
      case 'end': {
        if (!current) return undefined;
        const why = controlRefusal(current, who, here);
        // Someone who isn't the presenter ending a live presentation: refused like a takeover.
        if (why) throw forbidden(why);
        return null;
      }
      default:
        throw badRequest('action must be start, handoff or end');
    }
  });
  return result === undefined ? null : result;
}

// Icebreakers (#150): the SERVER spins the wheel, rolls the dice and shuffles the speaking order, so
// every client shows the same result, started at the same moment on the server's clock. Nothing is
// stored here: the result is published into the board (ICEBREAKER_RESULTS_COLLECTION, server-written
// only) next to the widget, like a live activity's results.
import { randomInt } from 'node:crypto';
import {
  ICEBREAKER_MAX_ENTRIES,
  ICEBREAKER_RESULTS_COLLECTION,
  ICEBREAKER_ROLL_MS,
  ICEBREAKER_SPIN_MS,
  guestDisplayName,
  type FacilitationSession,
  type IcebreakerElement,
  type IcebreakerResult,
  type Role,
} from '@freero/shared';
import { forbidden, notFound } from '../../platform/http';
import type { Actor } from '../auth/index';
import { actorId } from '../auth/index';
import { requireBoardAccess } from '../boards/index';
import { readBoardView, writeServerCollection } from '../realtime/index';

/** The entries a widget's result is drawn from: trimmed, non-empty, at most the cap. */
export function entriesOf(el: Pick<IcebreakerElement, 'entries'>): string[] {
  return (Array.isArray(el.entries) ? el.entries : [])
    .filter((e): e is string => typeof e === 'string')
    .map((e) => e.trim())
    .filter(Boolean)
    .slice(0, ICEBREAKER_MAX_ENTRIES);
}

/** A fresh result for `el` (`rand(n)`: a uniform integer in 0..n-1). */
export function draw(el: IcebreakerElement, rand: (n: number) => number): Omit<IcebreakerResult, 'elementId' | 'seq' | 'at' | 'by'> | null {
  const entries = entriesOf(el);
  switch (el.kind) {
    case 'wheel': {
      if (!entries.length) return null;
      const index = rand(entries.length);
      return { ms: ICEBREAKER_SPIN_MS, index, of: entries.length, picked: entries[index] };
    }
    case 'dice': {
      const n = typeof el.dice === 'number' && Number.isInteger(el.dice) ? Math.min(3, Math.max(1, el.dice)) : 1;
      return { ms: ICEBREAKER_ROLL_MS, dice: Array.from({ length: n }, () => rand(6) + 1) };
    }
    case 'speakers': {
      if (!entries.length) return null;
      const order = [...entries];
      for (let i = order.length - 1; i > 0; i--) {
        const j = rand(i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
      return { ms: ICEBREAKER_ROLL_MS, order };
    }
    default:
      return null;
  }
}

/**
 * Why this person may not spin now (null: they may). Owners and editors spin; while a facilitator
 * runs a session, only that facilitator and the owner. Everyone else watches the result.
 */
export function rollRefusal(role: Role, personId: string, session: FacilitationSession | undefined): string | null {
  if (role !== 'owner' && role !== 'editor') return 'Only the people running the session spin this';
  if (session?.by && session.by !== personId && role !== 'owner') return `${session.byName || 'The facilitator'} runs this session: they spin`;
  return null;
}

/**
 * Spins / rolls / shuffles the icebreaker `elementId` as `actor` sees the board. Owners and editors
 * may; while a facilitator runs a session, only that facilitator and the owner.
 */
export async function roll(boardId: string, elementId: string, actor: Actor, now = Date.now()): Promise<IcebreakerResult> {
  const personId = actorId(actor);
  const { role } = await requireBoardAccess(boardId, personId);
  const view = await readBoardView(boardId, { userId: personId, role });
  const why = rollRefusal(role, personId, view.collection('facilitation').get('session') as FacilitationSession | undefined);
  if (why) throw forbidden(why);
  const hit = view.elements.find((e) => e.el.id === elementId && e.el.type === 'icebreaker' && e.layer !== 'private');
  if (!hit) throw notFound('This icebreaker is no longer on the board');
  const el = hit.el as IcebreakerElement;
  const drawn = draw(el, (n) => randomInt(n));
  if (!drawn) throw forbidden('Add some names first');
  const prev = view.collection(ICEBREAKER_RESULTS_COLLECTION).get(elementId) as IcebreakerResult | undefined;
  const result: IcebreakerResult = {
    elementId,
    seq: (typeof prev?.seq === 'number' ? prev.seq : 0) + 1,
    at: now,
    by: actor.kind === 'user' ? actor.user.name : guestDisplayName(actor.guest.name),
    ...drawn,
  };
  await writeServerCollection(boardId, ICEBREAKER_RESULTS_COLLECTION, { [elementId]: result });
  return result;
}

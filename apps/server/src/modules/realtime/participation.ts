// Participants (parity rank 1, @freero/shared participation.ts): commenters and guests taking part
// in a facilitator's sessions without edit access. Enforced here and in the rules it combines:
//
//   who               a socket whose EFFECTIVE role is commenter (its access, or a facilitator's lock)
//                     while the board's switch is open (`facilitation` key PARTICIPATION_KEY,
//                     default open). rooms.ts recomputes it with the role and sends it in the role
//                     message (`participant`).
//   the shared doc    filter.ts lets its update through when it touches only `comments` (commenter
//                     rules) and PARTICIPANT_WRITABLE maps as plain keys; inside the transaction that
//                     applies it, votingRules.ts / estimationRules.ts undo whatever is not its own
//                     ballot or pick (the session, the round, others' entries, the history).
//   its private layer the same confinement for `elements`, `comments`, `voting`, `estimation`, then
//                     the vote and estimate rules, and `guardDrafts` below: a draft may be written
//                     only while private mode runs, of PRIVATE_MODE_TYPES (and of the types a
//                     facilitator allows, if they limit them), inside private mode's frame when it
//                     has one. Deleting its own drafts is always allowed.
//   reveals           its private layer takes part (rooms.ts onLayerOp) like an editor's. It may not
//                     run layer ops itself.
//
// Everything is compensation inside the applying transaction (facilitation.ts explains why), except
// an update that reaches outside those maps at all: only a forged client sends one, and it is
// dropped like a commenter's.
import * as Y from 'yjs';
import {
  FACILITATION_COLLECTION,
  PARTICIPATION_KEY,
  participationOpen,
  PRIVATE_MODE_COLLECTION,
  PRIVATE_MODE_KEY,
  PRIVATE_MODE_TYPES,
  Y_ELEMENTS,
  type Role,
} from '@freero/shared';
import { changedKeys, readFacilitation } from './facilitation';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Does the board let commenters and guests take part? */
export function participationIsOpen(doc: Y.Doc): boolean {
  if (!doc.share.has(FACILITATION_COLLECTION)) return true;
  return participationOpen(doc.getMap<unknown>(FACILITATION_COLLECTION).get(PARTICIPATION_KEY));
}

/** Is a socket with effective role `role` a participant on this board? */
export const isParticipant = (role: Role, open: boolean): boolean => role === 'commenter' && open;

/** Maps a participant's update may touch in its private layer (filter.ts confines it to them). */
export const PARTICIPANT_LAYER_ROOTS: ReadonlySet<string> = new Set([Y_ELEMENTS, 'voting', 'estimation']);

interface PrivateMode {
  frame: { x: number; y: number; w: number; h: number } | null;
}

/** The private mode running on `shared` (with its frame's box when scoped to one), or null. */
function runningPrivateMode(shared: Y.Doc): PrivateMode | null {
  const s = shared.getMap<unknown>(PRIVATE_MODE_COLLECTION).get(PRIVATE_MODE_KEY);
  if (!isObj(s) || s.active !== true) return null;
  if (typeof s.frameId !== 'string' || !s.frameId) return { frame: null };
  const f = shared.getMap<unknown>(Y_ELEMENTS).get(s.frameId);
  if (!isObj(f) || ![f.x, f.y, f.w, f.h].every((n) => typeof n === 'number')) return { frame: { x: 0, y: 0, w: 0, h: 0 } };
  return { frame: { x: f.x as number, y: f.y as number, w: f.w as number, h: f.h as number } };
}

const DRAFTABLE: ReadonlySet<string> = new Set(PRIVATE_MODE_TYPES);

/** May a participant hold element `el` as a draft while `mode` runs (the facilitator allowing `allowed` types)? */
export function mayDraft(el: unknown, mode: PrivateMode | null, allowed: readonly string[] | null): boolean {
  if (!mode || !isObj(el) || typeof el.type !== 'string' || !DRAFTABLE.has(el.type)) return false;
  if (allowed && !allowed.includes(el.type)) return false;
  if (!mode.frame) return true;
  const { x, y, w, h } = el as Record<string, unknown>;
  if (![x, y, w, h].every((n) => typeof n === 'number')) return false;
  const cx = (x as number) + (w as number) / 2;
  const cy = (y as number) + (h as number) / 2;
  const f = mode.frame;
  return cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h;
}

/**
 * Undoes this transaction's changes to a participant's own private layer `layer` that are not
 * drafts it may write (see the header). The elements map must exist before the transaction. True
 * when it undid something.
 */
export function guardDrafts(tr: Y.Transaction, layer: Y.Doc, shared: Y.Doc): boolean {
  const map = layer.getMap<unknown>(Y_ELEMENTS);
  const changes = changedKeys(tr, map);
  if (!changes.size) return false;
  const mode = runningPrivateMode(shared);
  const allowed = readFacilitation(shared)?.allowedTypes ?? null;
  let reverted = false;
  for (const [key, { before, after }] of changes) {
    if (after === undefined || mayDraft(after, mode, allowed)) continue;
    if (before === undefined) map.delete(key);
    else map.set(key, before);
    reverted = true;
  }
  return reverted;
}

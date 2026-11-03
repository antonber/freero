// Participants (parity rank 1): people who may comment — commenters and visitors without an account
// on a shared link — taking part in a facilitator's sessions without being able to edit the board.
// While the board lets them (`participationOpen`, default on), the SERVER lets such a connection
// write exactly three things of its own (apps/server/src/modules/realtime/participation.ts):
//
//   its ballot in a running vote                   `voting`      (votingRules.ts)
//   its planning-poker pick for the current item   `estimation`  (estimationRules.ts)
//   its private-mode drafts, while private mode    its private layer's `elements` (participation.ts)
//   runs, of PRIVATE_MODE_TYPES
//
// and nothing else: not the sessions, not anyone else's entry, no element in the shared doc. The
// server tells the client with `participant: true` in the role message (RoleMessage); the engine
// mirrors it (Editor.isParticipant). Once revealed, a draft is ordinary board content the
// participant can no longer change (editing stickies as a guest is a separate policy decision).
import type { ElementType } from './elements';
import { FACILITATION_COLLECTION } from './ydoc';

/**
 * The board's switch (`facilitation` collection, this key): may commenters and guests take part?
 * Absent: yes. Written by an owner, or by any editor while nobody facilitates — once a facilitation
 * session runs, only its facilitator or the owner (realtime facilitation.ts).
 */
export const PARTICIPATION_KEY = 'participation';
export const PARTICIPATION_COLLECTION = FACILITATION_COLLECTION;
export interface ParticipationSetting {
  open: boolean;
  by: string;
  at: number;
}
/** Does the setting value `v` let commenters and guests take part (absent or malformed: yes)? */
export const participationOpen = (v: unknown): boolean => !(v && typeof v === 'object' && (v as { open?: unknown }).open === false);

/**
 * What private mode makes private (features/private-mode) and so what a participant may draft:
 * content whose whole text lives in the element itself — not frames (containers) and not tables
 * (their cells live in a collection).
 */
export const PRIVATE_MODE_TYPES: readonly ElementType[] = ['sticky', 'shape', 'text', 'card', 'pen', 'emoji', 'image', 'connector'];
export const PRIVATE_MODE_COLLECTION = 'privateMode';
export const PRIVATE_MODE_KEY = 'session';

/**
 * Planning poker's collection (features/estimation): key ESTIMATION_ROUND_KEY holds the running
 * round, `estimateKey(round, item, user)` one person's pick for one item — its value in their
 * private layer, a `sealed` marker in the shared doc until the item is revealed.
 */
export const ESTIMATION_COLLECTION = 'estimation';
export const ESTIMATION_ROUND_KEY = 'round';
export const estimateKey = (roundId: string, itemId: string, userId: string) => `v:${roundId}:${itemId}:${userId}`;
export const estimatePrefix = (roundId: string, itemId: string) => `v:${roundId}:${itemId}:`;

// Boards and the items on them as objects of the registry (modules/objects, KAI-147). Access is
// exactly the board page's: describeAccess / resolveRole (owner, membership, team access, link,
// workspace policies and blocks, guests on their one board), batched for many boards at once.
// An item is seen by whoever sees its board AND sees the item in their view of it (realtime's
// readBoardView: no hidden frame's contents for viewers, no one else's draft).
import { isGuestId, objectKey, objectPath, richTextToPlain, type BoardElement, type ObjectAction, type ObjectRef, type ObjectSummary, type Role } from '@freero/shared';
import { getGuests } from '../auth/index';
import { membershipsOf, resolveGuestRole, resolveRole } from '../members/index';
import { registerObjectType, type AccessPurpose, type Actor, type ObjectLookup, type ObjectTypeHandler } from '../objects/index';
import { readBoardView } from '../realtime/index';
import { boardAccessLoader } from '../workspaces/index';
import * as repo from './repo';
import type { Board } from './repo';
import { linkAsSeenBy } from './service';

const ACTION_OF: Record<Role, ObjectAction> = { viewer: 'view', commenter: 'comment', editor: 'edit', owner: 'manage' };

/**
 * The actor's role on each of these live boards (trashed / taken-down ones are absent), in a
 * fixed number of queries whatever the count. 'discover' leaves out boards reached only through
 * their link that the actor never opened (see AccessPurpose). A password-protected link counts only
 * for someone who gave its CURRENT password (KAI-145), as on the board page.
 */
export async function boardRoles(actor: Actor, boardIds: string[], purpose: AccessPurpose): Promise<Map<string, { board: Board; role: Role }>> {
  const out = new Map<string, { board: Board; role: Role }>();
  const ids = [...new Set(boardIds)];
  if (!ids.length || !actor.userId) return out;
  if (isGuestId(actor.userId)) {
    // A guest reaches only the board they joined.
    const joined = (await getGuests([actor.userId])).get(actor.userId)?.boardId;
    if (!joined || !ids.includes(joined)) return out;
    const board = await repo.getBoard(joined);
    if (!board) return out;
    const [access, unlocks] = await Promise.all([boardAccessLoader(actor.userId, [board.workspaceId]), repo.unlocksOf(actor.userId, [board.id])]);
    const role = resolveGuestRole(linkAsSeenBy(board, unlocks.get(board.id)), access(board));
    if (role) out.set(board.id, { board, role });
    return out;
  }
  const boards = await repo.getBoards(ids);
  if (!boards.length) return out;
  const [memberships, accessOf, opens, unlocks] = await Promise.all([
    membershipsOf(actor.userId),
    boardAccessLoader(actor.userId, boards.map((b) => b.workspaceId)),
    purpose === 'discover' ? repo.opensOf(actor.userId) : Promise.resolve(new Map<string, number>()),
    repo.unlocksOf(actor.userId, boards.map((b) => b.id)),
  ]);
  for (const board of boards) {
    const access = accessOf(board);
    const member = memberships.get(board.id) ?? null;
    const role = resolveRole(linkAsSeenBy(board, unlocks.get(board.id)), actor.userId, member, access);
    if (!role) continue;
    if (purpose === 'discover' && !opens.has(board.id) && !resolveRole({ ...board, linkAccess: 'none' }, actor.userId, member, access)) continue;
    out.set(board.id, { board, role });
  }
  return out;
}

/** A short plain title for an item: its own title or text, else nothing (the client names the type). */
export function elementTitle(el: BoardElement): string {
  const e = el as unknown as Record<string, unknown>;
  for (const k of ['title', 'text', 'label', 'name']) {
    const v = e[k];
    if (typeof v !== 'string' || !v.trim()) continue;
    const plain = (v.includes('<') ? richTextToPlain(v) : v).replace(/\s+/g, ' ').trim();
    if (plain) return plain.length > 120 ? `${plain.slice(0, 119)}…` : plain;
  }
  return '';
}

const boardSummary = (board: Board, role: Role): ObjectSummary => ({
  type: 'board',
  title: board.title,
  image: board.thumbnail,
  path: objectPath({ type: 'board', id: board.id }),
  access: ACTION_OF[role],
});

export const boardObjects: ObjectTypeHandler = {
  type: 'board',
  async lookup(actor, refs, { purpose }) {
    const roles = await boardRoles(actor, refs.map((r) => r.id), purpose);
    const out = new Map<string, ObjectLookup>();
    for (const ref of refs) {
      const found = roles.get(ref.id);
      if (found) out.set(objectKey(ref), { access: ACTION_OF[found.role], summary: boardSummary(found.board, found.role) });
    }
    return out;
  },
};

export const elementObjects: ObjectTypeHandler = {
  type: 'element',
  async lookup(actor, refs, { purpose }) {
    const items = refs.filter((r): r is Extract<ObjectRef, { type: 'element' }> => r.type === 'element');
    const roles = await boardRoles(actor, items.map((r) => r.boardId), purpose);
    const out = new Map<string, ObjectLookup>();
    // One view per board, as THIS reader sees it.
    await Promise.all(
      [...roles].map(async ([boardId, { board, role }]) => {
        const wanted = items.filter((r) => r.boardId === boardId);
        const view = await readBoardView(boardId, { userId: actor.userId, role });
        const seen = new Map(view.elements.map(({ el }) => [el.id, el]));
        for (const ref of wanted) {
          const el = seen.get(ref.id);
          if (!el) continue;
          out.set(objectKey(ref), {
            access: ACTION_OF[role],
            summary: {
              type: 'element',
              title: elementTitle(el),
              kind: el.type,
              board: { id: board.id, title: board.title },
              path: objectPath(ref),
              access: ACTION_OF[role],
            },
          });
        }
      }),
    );
    return out;
  },
};

/** Boards and their items join the object registry (init.ts; tests call it too). */
export function registerBoardObjectTypes(): void {
  registerObjectType(boardObjects);
  registerObjectType(elementObjects);
}

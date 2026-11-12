// The operators' "Public links" view (modules/moderation) lists exactly the boards a link opens now.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { boardsSharedByLink, takeDownBoard, touchBoard, trashBoard } from './index';
import { changeLinkProtection } from './linkProtection';
import * as repo from './repo';
import { createBoard } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const person = (name: string) => createUser({ name, email: `${name.toLowerCase()}-${++n}@shared-links.test.freero.app`, password: 'password-123' });

/** Every board listed at `now`, all pages. */
async function listed(now: number): Promise<string[]> {
  const ids: string[] = [];
  let before: string | null = null;
  do {
    const page = await boardsSharedByLink({ before, limit: 2 }, now);
    ids.push(...page.boards.map((b) => b.id));
    before = page.nextBefore;
  } while (before);
  return ids;
}

// (A link an operator blocked: moderation/publicLinks.test.ts, through the console's own action.)
it('an expired, trashed or taken-down board’s link is not listed, nor a board without a link', async () => {
  const owner = await person('Sharer');
  const open = await createBoard(owner.id, 'Open', '', 'viewer');
  const privateBoard = await createBoard(owner.id, 'Private', '');
  const expiring = await createBoard(owner.id, 'Expiring', '', 'commenter');
  const trashed = await createBoard(owner.id, 'Trashed', '', 'viewer');
  const takenDown = await createBoard(owner.id, 'Taken down', '', 'viewer');
  const expiresAt = Date.now() + 60_000;
  await changeLinkProtection((await repo.getBoard(expiring.id))!, owner.id, { linkExpiresAt: expiresAt });
  await trashBoard(trashed.id, owner.id);
  await takeDownBoard(takenDown.id);

  const mine = [open.id, privateBoard.id, expiring.id, trashed.id, takenDown.id];
  const before = (await listed(Date.now())).filter((id) => mine.includes(id));
  expect(before.sort()).toEqual([open.id, expiring.id].sort());
  // The moment the owner's expiry passes, the link opens nothing and the board leaves the list.
  expect((await listed(expiresAt)).filter((id) => mine.includes(id))).toEqual([open.id]);
});

it('paging through the list neither skips nor repeats a board when the one a page ended on is edited meanwhile', async () => {
  const owner = await person('Pager');
  const a = await createBoard(owner.id, 'A', '', 'viewer');
  const b = await createBoard(owner.id, 'B', '', 'viewer');
  const c = await createBoard(owner.id, 'C', '', 'viewer');
  const t = Date.now() + 10_000;
  await touchBoard(a.id, t);
  await touchBoard(b.id, t + 1);
  await touchBoard(c.id, t + 2); // newest first: c, b, a

  const first = await boardsSharedByLink({ before: null, limit: 2 });
  expect(first.boards.map((x) => x.id)).toEqual([c.id, b.id]);
  // Someone edits the board the first page ended on: it moves to the top, onto the page already read.
  await touchBoard(b.id, t + 3);
  const second = await boardsSharedByLink({ before: first.nextBefore, limit: 2 });
  expect(second.boards.map((x) => x.id)[0]).toBe(a.id);
  expect(second.boards.map((x) => x.id)).not.toContain(b.id);
  expect(second.boards.map((x) => x.id)).not.toContain(c.id);
});

// "Changes on your boards" (#46) and time zones: the email goes out once per morning where the
// reader is, says what others did, and its own link stops only it.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { User } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { closeTestDb, openTestDb, outboxMails } from '../../platform/testing';
import { flushActivityBursts as flushBursts, recordBoardChanges as recordChanges } from '../activity/index';
import { createUser, getAccount, markEmailVerified, updateProfile } from '../auth/index';
import { createBoard } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { sendBoardChangeDigests, setBoardChangesFrequency } from './boardChanges';
import { prefsFor, unsubscribe, unsubscribeToken } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
async function person(label: string, timeZone?: string): Promise<User> {
  const email = `${label.toLowerCase()}-${++n}@changes.test.freero.app`;
  const u = await createUser({ name: label, email, password: 'password-123' });
  await markEmailVerified(u.id, email);
  if (timeZone) await updateProfile(u.id, { timeZone });
  return u;
}
const mailsTo = (to: string) => outboxMails().filter((m) => m.to === to);
const HOUR = 3_600_000;

it('the daily summary of changes on your boards arrives once, on your morning — and its own link stops only it', async () => {
  const [ann, bob] = [await person('Ann', 'Asia/Tokyo'), await person('Bob')];
  const board = await createBoard(ann.id, 'Offsite', '', 'none');
  await inviteBoardMember(null, board.id, await getAccount(ann.id), { email: bob.email, role: 'editor' });
  // Ann turns it on at 21:00 in Tokyo (12:00 UTC); Bob works on her board an hour later, Ann too.
  const t0 = Date.UTC(2026, 10, 2, 12);
  await setBoardChangesFrequency(ann.id, 'daily', t0);
  const edit = (who: User, ids: string[], at: number) =>
    recordChanges({ boardId: board.id, actorId: who.id, actorName: who.name, layer: 'shared', changes: ids.map((id) => ({ id, op: 'add', type: 'sticky', frameId: null })), frameTitles: {} }, at);
  edit(bob, ['s1', 's2'], t0 + HOUR);
  edit(ann, ['mine'], t0 + HOUR);
  await flushBursts(t0 + HOUR + getConfig().activityIdleMs, true);

  // Midnight in Tokyo is not morning yet; 08:00 there (23:00 UTC) is.
  await sendBoardChangeDigests(t0 + 3 * HOUR);
  expect(mailsTo(ann.email)).toHaveLength(0);
  await sendBoardChangeDigests(t0 + 11 * HOUR);
  await sendBoardChangeDigests(t0 + 12 * HOUR);
  const mails = mailsTo(ann.email);
  expect(mails).toHaveLength(1);
  expect(mails[0].text).toContain('“Offsite”: Bob added 2 items');
  expect(mails[0].text).toContain('21:00 (Asia/Tokyo)');
  expect(mails[0].text).toContain(`/board/${board.id}?changes=1`);

  // The link names its list: an all-emails token can't be bent into it, and it leaves other emails on.
  const token = decodeURIComponent(/\/unsubscribe\?token=([^&\s]+)&list=board-changes/.exec(mails[0].text)![1]);
  expect(await unsubscribe(unsubscribeToken(ann.id), 'board-changes')).toBeNull();
  expect(await unsubscribe(token)).toBeNull();
  expect(await unsubscribe(token, 'board-changes')).toBe(ann.email);
  const prefs = await prefsFor(ann.id);
  expect(prefs.boardChanges).toBe('off');
  expect(prefs.emailAll).toBe(true);
});

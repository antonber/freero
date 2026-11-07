// The `notifications:digest` job as a whole: due-date reminders, the notification digest and
// "changes on your boards" in one run. One person or board that fails (a board whose document can't
// be loaded right now: a workspace key's KMS unreachable, a damaged stored row; an address the mail
// server refuses) must not stop or crowd out everybody else's email.
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { User } from '@freero/shared';
import { createContext } from '../../platform/context';
import type { Config } from '../../platform/config';
import { closeTestDb, mailIdle, openTestDb, outboxMails } from '../../platform/testing';
import { localDate } from '../../platform/time';
import { createUser, markEmailVerified } from '../auth/index';
import { createBoard } from '../boards/index';
import initNotifications from './init';
import * as repo from './repo';
import { notify, sendDigests } from './service';

const unloadable = vi.hoisted(() => new Set<string>());
vi.mock('../realtime/index', async (importOriginal) => {
  const real = await importOriginal<typeof import('../realtime/index')>();
  return {
    ...real,
    readBoardView: async (boardId: string, reader: Parameters<typeof real.readBoardView>[1]) => {
      if (unloadable.has(boardId)) throw new Error(`could not load board ${boardId}`);
      return real.readBoardView(boardId, reader);
    },
  };
});

// The mail server refuses these addresses for good (550: no such mailbox).
const refused = vi.hoisted(() => ({ to: new Set<string>(), attempts: 0 }));
vi.mock('../../platform/mail', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../platform/mail')>();
  return {
    ...real,
    sendMail: async (mail: Parameters<typeof real.sendMail>[0]) => {
      if (!refused.to.has(mail.to)) return real.sendMail(mail);
      refused.attempts++;
      throw new Error('550 5.1.1 mailbox unavailable');
    },
  };
});

let config: Config;
beforeAll(async () => {
  config = await openTestDb({ NOTIFY_EMAIL_DELAY_SECONDS: '0', NOTIFY_EMAIL_INTERVAL_SECONDS: '1', FREERO_DOC_IDLE_MS: '100' });
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 300));
  await closeTestDb();
});

let n = 0;
async function person(label: string): Promise<User> {
  const email = `${label.toLowerCase()}-${++n}@digest.test.freero.app`;
  const u = await createUser({ name: label, email, password: 'password-123' });
  await markEmailVerified(u.id, email);
  return { ...u, email };
}

it('one board that cannot be loaded for a due-date reminder does not stop every other person’s digest email', async () => {
  const [alice, bob, carol] = [await person('Alice'), await person('Bob'), await person('Carol')];
  // Alice has a mention waiting for her digest (delay 0: due at the job's next run).
  const shared = await createBoard(alice.id, 'Roadmap', '', 'editor');
  expect(
    await notify({ userId: alice.id, type: 'comment.mention', actorId: bob.id, boardId: shared.id, data: { boardTitle: 'Roadmap', threadId: 't1', messageId: 'm1', excerpt: 'look' } }),
  ).toBe(true);
  // Carol, elsewhere, has a card due tomorrow on a board whose document fails to load.
  const broken = await createBoard(carol.id, 'Carol’s plans', '');
  const tomorrow = localDate(Date.now() + 24 * 3_600_000, null);
  await repo.setCardDueWatch(broken.id, 'card1', { assigneeId: carol.id, dueDate: tomorrow, title: 'Ship it' });
  unloadable.add(broken.id);

  const ctx = createContext(config);
  initNotifications(ctx); // the real job: first run after 1 s, then every second
  const deadline = Date.now() + 3500;
  while (Date.now() < deadline && !outboxMails().some((m) => m.to === alice.email)) await new Promise((r) => setTimeout(r, 100));
  await ctx.shutdown();
  await mailIdle();

  expect(outboxMails().filter((m) => m.to === alice.email)).toHaveLength(1);
}, 10_000);

it('a digest the mail server refuses for good is not tried again every run and is given up on, while other people’s digests still go out', async () => {
  const [gone, erin] = [await person('Gone'), await person('Erin')];
  refused.to.add(gone.email);
  for (const [to, from] of [[gone, erin], [erin, gone]]) {
    const board = await createBoard(to.id, 'Plans', '');
    await notify({ userId: to.id, type: 'comment.mention', actorId: from.id, boardId: board.id, data: { boardTitle: 'Plans', threadId: 't1', messageId: 'm1', excerpt: 'look' } });
  }
  const start = Date.now() + 1000;
  const MINUTE = 60_000;
  await sendDigests(start);
  await sendDigests(start + MINUTE); // the next run
  expect({ refusedAttempts: refused.attempts, erinMails: outboxMails().filter((m) => m.to === erin.email).length }).toEqual({ refusedAttempts: 1, erinMails: 1 });

  // Two days of runs, every ten minutes: tried again now and then, then no more.
  for (let at = start + 10 * MINUTE; at < start + 2 * 24 * 60 * MINUTE; at += 10 * MINUTE) await sendDigests(at);
  const tried = refused.attempts;
  for (let at = start + 2 * 24 * 60 * MINUTE; at < start + 3 * 24 * 60 * MINUTE; at += 10 * MINUTE) await sendDigests(at);
  expect(tried).toBeGreaterThan(1);
  expect(refused.attempts).toBe(tried);
}, 60_000);

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Config } from './config';
import { createContext } from './context';
import { sendMailLater } from './mail';
import { closeTestDb, openTestDb, outboxMails } from './testing';

let config: Config;
beforeAll(async () => {
  config = await openTestDb();
});
afterAll(() => closeTestDb());

it('a mail queued with sendMailLater just before a graceful shutdown (a moderation notice with its appeal link) is sent before the server stops', async () => {
  const ctx = createContext(config);
  // Worded after a lookup that takes a moment (the reader's language, time zone…).
  const notice = new Promise<{ to: string; subject: string; text: string; html: string }>((res) =>
    setTimeout(() => res({ to: 'moderated@mail.test.freero.app', subject: 'Your board was removed', text: 'appeal: …', html: '<p>appeal</p>' }), 200),
  );
  sendMailLater(notice);
  await ctx.shutdown();
  expect(outboxMails().map((m) => m.to)).toContain('moderated@mail.test.freero.app');
});

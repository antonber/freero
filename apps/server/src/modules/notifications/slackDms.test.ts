// Notifications as Slack direct messages (#105), deduplicated with the email digest. Slack itself
// stands in at modules/slack's public API: who connected Slack, and what reached them there (the
// Slack module's own tests cover the Web API calls).
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { mentionToken, type User } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { closeTestDb, openTestDb, outboxMails } from '../../platform/testing';
import { createUser, markEmailVerified } from '../auth/index';
import { createBoard } from '../boards/index';
import type { CommentMessageEvent } from '../realtime/index';
import { createTeamWorkspace } from '../workspaces/index';
import { onCommentMessage, prefsFor, sendDigests, slackDeliveriesSettled, updatePrefs } from './service';

const slack = vi.hoisted(() => ({
  linked: new Set<string>(),
  dms: [] as Array<{ userId: string; title: string; quote?: string; url: string }>,
  refuse: false,
  /** Workspaces whose policies keep the app out (modules/slack decides that from apiauth's rules). */
  keptOut: new Set<string>(),
}));
vi.mock('../slack/index', () => ({
  slackConnectOffered: () => true,
  slackLinked: async (userId: string) => slack.linked.has(userId),
  slackMayReach: async (_userId: string, workspaceId: string) => !slack.keptOut.has(workspaceId),
  sendSlackDm: async (userId: string, m: { title: string; quote?: string; url: string }) => {
    if (!slack.linked.has(userId)) return 'not_linked';
    if (slack.refuse) return 'failed';
    slack.dms.push({ userId, ...m });
    return 'sent';
  },
}));

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());
beforeEach(() => {
  slack.dms.length = 0;
  slack.refuse = false;
});

let n = 0;
async function person(label: string): Promise<User> {
  const email = `${label.toLowerCase()}-${++n}@slackdm.test.freero.app`;
  const u = await createUser({ name: label, email, password: 'password-123' });
  await markEmailVerified(u.id, email);
  return u;
}
let seq = 0;
const message = (boardId: string, authorId: string, text: string, more: Partial<CommentMessageEvent> = {}): CommentMessageEvent => ({
  boardId,
  authorId,
  threadId: 't1',
  messageId: `m${++seq}`,
  text,
  previousText: null,
  participantIds: [],
  layer: 'shared',
  ...more,
});
const mailsTo = (to: string) => outboxMails().filter((m) => m.to === to);
let clock = Date.now();
/** Runs the digest job past the email delay, as the next scheduled run would. */
const digest = async () => {
  await slackDeliveriesSettled();
  clock += getConfig().notifyEmailDelayMs + 60_000;
  await sendDigests(clock);
};

it('a reply that also mentions someone who connected Slack reaches them as one direct message — not one per way they are notified, and not again in the email digest', async () => {
  const [ann, bob, cy] = [await person('Ann'), await person('Bob'), await person('Cy')];
  slack.linked.add(bob.id);
  const board = await createBoard(ann.id, 'Launch', '', 'commenter');
  const reply = message(board.id, cy.id, `Can you take this ${mentionToken(bob.id)}?`, { participantIds: [ann.id, bob.id] });
  await onCommentMessage(reply);
  await onCommentMessage({ ...reply, previousText: reply.text, text: `${reply.text} Thanks` }); // an edit
  await slackDeliveriesSettled();

  expect(slack.dms.map((d) => d.userId)).toEqual([bob.id]);
  expect(slack.dms[0].quote).toBe('Can you take this @Bob?');
  expect(slack.dms[0].url).toMatch(new RegExp(`^https?://[^/]+/board/${board.id}\\?thread=t1$`));
  expect(slack.dms[0].title).toContain('Launch');
  await digest();
  await digest();
  expect(mailsTo(bob.email)).toHaveLength(0);
  // Ann never connected Slack: her reply notification is emailed as before.
  expect(mailsTo(ann.email)).toHaveLength(1);
});

it('when Slack refuses the message, or the person turned that kind off for Slack, it is emailed instead — once', async () => {
  const [ann, dee] = [await person('Ann'), await person('Dee')];
  slack.linked.add(dee.id);
  const board = await createBoard(ann.id, 'Budget', '', 'commenter');

  slack.refuse = true;
  await onCommentMessage(message(board.id, ann.id, `numbers please ${mentionToken(dee.id)}`));
  await digest();
  await digest();
  expect(mailsTo(dee.email)).toHaveLength(1);
  expect(mailsTo(dee.email)[0].text).toContain('numbers please');

  slack.refuse = false;
  await updatePrefs(dee.id, { slack: { 'comment.mention': false } });
  expect((await prefsFor(dee.id)).types.find((t) => t.type === 'comment.mention')).toMatchObject({ email: true, slack: false });
  await onCommentMessage(message(board.id, ann.id, `and the forecast ${mentionToken(dee.id)}`));
  await digest();
  expect(slack.dms).toHaveLength(0);
  expect(mailsTo(dee.email).map((m) => m.text).filter((t) => t.includes('and the forecast'))).toHaveLength(1);
});

it('a notification about a board in a team workspace that keeps apps out (API access off, the app blocked, an IP allowlist) is emailed, not sent to Slack', async () => {
  const [ann, erin] = [await person('Ann'), await person('Erin')];
  slack.linked.add(erin.id);
  const team = await createTeamWorkspace(ann.id, 'Corp dev');
  slack.keptOut.add(team.id);
  const board = await createBoard(ann.id, 'Due diligence', '', 'commenter', { workspaceId: team.id, projectId: null });
  await onCommentMessage(message(board.id, ann.id, `the data room ${mentionToken(erin.id)}`));
  await digest();
  expect(slack.dms).toHaveLength(0);
  expect(mailsTo(erin.email).filter((m) => m.text.includes('the data room'))).toHaveLength(1);
});

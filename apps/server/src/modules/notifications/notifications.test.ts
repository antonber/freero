import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mentionToken, type User } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { outboxDir } from '../../platform/mail';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser, getAccount, markEmailVerified } from '../auth/index';
import { createBoard } from '../boards/index';
import { decideAccessRequest, onAccessDecided, onAccessRequested, requestAccess } from '../members/index';
import * as service from './service';
import type { CommentMessageEvent } from '../realtime/index';
import { createTeamWorkspace, inviteToWorkspace, removeWorkspaceMember } from '../workspaces/index';
import { emailsIn, listFor, markRead, onCommentMessage, sendDigests, unsubscribe, unsubscribeToken, updatePrefs } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
async function person(label: string, verified = true): Promise<User> {
  const email = `${label.toLowerCase()}-${++n}@notify.test.freero.app`;
  const u = await createUser({ name: label, email, password: 'password-123' });
  if (verified) await markEmailVerified(u.id, email);
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
  ...more,
});

const inbox = async (u: User) => (await listFor(u.id)).notifications;

function mailsTo(to: string): Array<{ subject: string; text: string; headers?: Record<string, string> }> {
  if (!fs.existsSync(outboxDir())) return [];
  return fs
    .readdirSync(outboxDir())
    .map((f) => JSON.parse(fs.readFileSync(path.join(outboxDir(), f), 'utf8')))
    .filter((m) => m.to === to);
}

it('a mention notifies the mentioned person once with a link to the thread — never the author, never someone who cannot open the board', async () => {
  const [ann, bob, outsider] = [await person('Ann'), await person('Bob'), await person('Outsider')];
  const open = await createBoard(ann.id, 'Roadmap', '', 'commenter'); // anyone signed in may comment
  const closed = await createBoard(ann.id, 'Private', '', 'none');

  const e = message(open.id, ann.id, `Hey ${mentionToken(bob.id)} and ${mentionToken(ann.id)}, look`);
  await onCommentMessage(e);
  await onCommentMessage({ ...e, previousText: e.text, text: `${e.text}!` }); // an edit keeping the mention
  await onCommentMessage(message(closed.id, ann.id, `psst ${mentionToken(outsider.id)}`));

  const got = await inbox(bob);
  expect(got).toHaveLength(1);
  expect(got[0]).toMatchObject({ type: 'comment.mention', link: `/board/${open.id}?thread=t1`, body: 'Hey @Bob and @Ann, look', actor: { id: ann.id } });
  expect(got[0].title).toContain('Roadmap');
  expect(await inbox(ann)).toHaveLength(0);
  expect(await inbox(outsider)).toHaveLength(0);
});

it('a reply notifies everyone else in the thread; someone it also mentions gets just the mention, and editing a message never re-notifies replies', async () => {
  const [ann, bob, cy] = [await person('Ann'), await person('Bob'), await person('Cy')];
  const board = await createBoard(ann.id, 'Retro', '', 'commenter');
  const reply = message(board.id, cy.id, `On it ${mentionToken(bob.id)}`, { participantIds: [ann.id, bob.id] });
  await onCommentMessage(reply);
  await onCommentMessage({ ...reply, previousText: reply.text, text: `${reply.text} today` });

  expect((await inbox(ann)).map((x) => x.type)).toEqual(['comment.reply']);
  expect((await inbox(bob)).map((x) => x.type)).toEqual(['comment.mention']);
  expect(await inbox(cy)).toHaveLength(0);
});

it('the email digest batches everything unread past the delay into one message, skips what was read or opted out, and its unsubscribe link turns emails off', async () => {
  const [ann, bob] = [await person('Ann'), await person('Bob')];
  const board = await createBoard(ann.id, 'Launch', '', 'commenter');
  const send = (text: string) => onCommentMessage(message(board.id, ann.id, text));
  await send(`first ${mentionToken(bob.id)}`);
  await send(`second ${mentionToken(bob.id)}`);
  await send(`seen already ${mentionToken(bob.id)}`);
  const seen = (await inbox(bob)).find((x) => x.body.startsWith('seen'))!;
  await markRead(bob.id, [seen.id]);

  await sendDigests(Date.now()); // nothing is past the delay yet
  expect(mailsTo(bob.email)).toHaveLength(0);
  const later = Date.now() + getConfig().notifyEmailDelayMs + 1000;
  await sendDigests(later);
  await sendDigests(later + 1000); // already dealt with: nothing twice
  const mails = mailsTo(bob.email);
  expect(mails).toHaveLength(1);
  expect(mails[0].text).toContain('“first @Bob”');
  expect(mails[0].text).toContain('“second @Bob”');
  expect(mails[0].text).not.toContain('seen already');
  expect(mails[0].text).toContain(`/board/${board.id}?thread=t1`);
  expect(mails[0].headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

  // Opted out of mentions: a new one shows in the app but is never emailed.
  await updatePrefs(bob.id, { email: { 'comment.mention': false } });
  await send(`third ${mentionToken(bob.id)}`);
  await sendDigests(later + 2 * getConfig().notifyEmailDelayMs + 5000);
  expect(mailsTo(bob.email)).toHaveLength(1);
  expect((await inbox(bob)).some((x) => x.body.startsWith('third'))).toBe(true);

  // The link is bound to its user; a forged or altered one does nothing.
  const token = /\/unsubscribe\?token=([^\s]+)/.exec(mails[0].text)![1];
  expect(await unsubscribe(unsubscribeToken(ann.id).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBeNull();
  expect(await unsubscribe(decodeURIComponent(token))).toBe(bob.email);
  await updatePrefs(bob.id, { email: { 'comment.mention': true } });
  await send(`fourth ${mentionToken(bob.id)}`);
  await sendDigests(later + 4 * getConfig().notifyEmailDelayMs + 10_000);
  expect(mailsTo(bob.email)).toHaveLength(1);
});

it('an invited address written at the end of a sentence, in any case, still names that invite', () => {
  expect(emailsIn('Looping in Zoe.Doe@Example.com. And kim@ex-ample.org, too')).toEqual(['zoe.doe@example.com', 'kim@ex-ample.org']);
});

it('an unverified address never gets digest emails', async () => {
  const ann = await person('Ann');
  const ghost = await person('Ghost', false);
  const board = await createBoard(ann.id, 'Draft', '', 'commenter');
  await onCommentMessage(message(board.id, ann.id, `hi ${mentionToken(ghost.id)}`));
  await sendDigests(Date.now() + getConfig().notifyEmailDelayMs + 1000);
  expect(await inbox(ghost)).toHaveLength(1);
  expect(mailsTo(ghost.email)).toHaveLength(0);
});

it('team access counts for notifications: a team member is told about a mention on a team board and about being added; once removed from the team, nothing more', async () => {
  const [lead, teammate] = await Promise.all([person('Lead'), person('Teammate')]);
  const ws = await createTeamWorkspace(lead.id, 'Studio');
  await inviteToWorkspace(null, ws.id, { ...lead, emailVerified: true }, { email: teammate.email, role: 'member' });
  expect((await inbox(teammate)).map((x) => x.type)).toEqual(['workspace.invite']);
  expect((await inbox(teammate))[0].link).toBe(`/app?ws=${ws.id}`);

  // No board invite: the teammate reaches the board through the team only.
  const board = await createBoard(lead.id, 'Team board', '', 'none', { workspaceId: ws.id });
  await onCommentMessage(message(board.id, lead.id, `ping ${mentionToken(teammate.id)}`));
  expect((await inbox(teammate)).map((x) => x.type)).toEqual(['comment.mention', 'workspace.invite']);

  await removeWorkspaceMember(ws.id, lead.id, teammate.id);
  await onCommentMessage(message(board.id, lead.id, `again ${mentionToken(teammate.id)}`));
  expect(await inbox(teammate)).toHaveLength(2);
});

it('a guest’s reply on a shared board notifies the thread as a guest; their @mentions page nobody', async () => {
  const [ann, bob] = await Promise.all([person('Ann'), person('Bob')]);
  const board = await createBoard(ann.id, 'Open house', '', 'commenter');
  await onCommentMessage(message(board.id, 'guest_abc', `hi ${mentionToken(bob.id)}`, { participantIds: [ann.id, 'guest_other'] }));
  expect(await inbox(bob)).toHaveLength(0);
  const [reply] = await inbox(ann);
  expect(reply).toMatchObject({ type: 'comment.reply', actor: null });
  expect(reply.title).toMatch(/^Guest · /);
});

it('an access request reaches the owner with its message and buttons; a "no" reaches the asker without the board’s title', async () => {
  onAccessRequested(service.onAccessRequested);
  onAccessDecided(service.onAccessDecided);
  const [owner, asker] = await Promise.all([person('Holder'), person('Asker')]);
  const board = await createBoard(owner.id, 'Acquisition plan', '', 'none');
  await requestAccess(board.id, await getAccount(asker.id), { role: 'commenter', message: 'I run the data room' });

  const [ask] = await inbox(owner);
  expect(ask).toMatchObject({ type: 'access.request', body: 'I run the data room', accessRequest: { status: 'pending', role: 'commenter', canDecide: true } });
  await decideAccessRequest(board.id, await getAccount(owner.id), asker.id, { decision: 'deny' });

  const [answer] = await inbox(asker);
  expect(answer.type).toBe('access.response');
  expect(answer.title).not.toContain('Acquisition');
  expect(answer.link).toBe(`/board/${board.id}`); // the request page
  expect((await inbox(owner))[0].accessRequest).toMatchObject({ status: 'denied', canDecide: false });
});

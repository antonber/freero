// Community listings in the moderation console (#87): decisions are operators' actions, recorded
// and audited like every other; reports reach the same queue.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { onAuditEvent, type AuditEvent } from '../../platform/audit';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser, getAccount } from '../auth/index';
import { listingFor, liveListings, submitListing } from '../marketplace/index';
import { act, queue, submitReport } from './service';

const audited: AuditEvent[] = [];
let stop = () => {};
beforeAll(async () => {
  await openTestDb();
  stop = onAuditEvent((e) => void audited.push(e));
});
afterAll(async () => {
  stop();
  await closeTestDb();
});

let n = 0;
const account = async (name: string) =>
  getAccount((await createUser({ name, email: `${name.toLowerCase()}-${++n}@modlistings.test.freero.app`, password: 'password-123' }, { emailVerified: true })).id);
const submit = (dev: Awaited<ReturnType<typeof account>>, name: string) =>
  submitListing(dev, { name, tagline: 'Turns retro boards into action items.', website: 'https://retro.example.com', category: 'automation', builtOn: ['api'] });

it('approving and removing a listing are each in the audit trail of its submitter, with the operator as actor', async () => {
  const op = await account('ListingOp');
  const dev = await account('ListingDev');
  const listing = await submit(dev, 'Retro helper');

  await act(op.id, { action: 'listing.approve', targetId: listing.id, statement: '' });
  await act(op.id, { action: 'listing.remove', targetId: listing.id, reason: 'spam', statement: 'It links to an unrelated shop.' });

  const about = audited.filter((e) => e.detail?.targetId === listing.id);
  expect(about.map((e) => e.action)).toEqual(['moderation.listing.approve', 'moderation.listing.remove']);
  for (const e of about) expect(e).toMatchObject({ userId: dev.id, actor: { kind: 'user', userId: op.id } });
  // A decision that changes nothing is refused, and so never recorded twice.
  await expect(act(op.id, { action: 'listing.remove', targetId: listing.id, reason: 'spam', statement: 'Again.' })).rejects.toMatchObject({ status: 409 });
  expect(audited.filter((e) => e.detail?.targetId === listing.id)).toHaveLength(2);
});

it('declining a submission needs a statement for its submitter, and keeps it hidden', async () => {
  const op = await account('DeclineOp');
  const dev = await account('DeclineDev');
  const listing = await submit(dev, 'Half-built');
  await expect(act(op.id, { action: 'listing.reject', targetId: listing.id, reason: 'other', statement: '' })).rejects.toMatchObject({ status: 400 });
  await act(op.id, { action: 'listing.reject', targetId: listing.id, reason: 'other', statement: 'The website shows no product yet.' });
  expect((await liveListings()).map((l) => l.id)).not.toContain(listing.id);
  expect(await listingFor(listing.id, dev.id)).toMatchObject({ status: 'rejected', statusNote: 'The website shows no product yet.' });
  expect(audited.some((e) => e.action === 'moderation.listing.reject' && e.detail?.targetId === listing.id)).toBe(true);
});

it('only a live listing can be reported, and the report reaches the queue with the listing’s current state', async () => {
  const op = await account('ReportOp');
  const dev = await account('ReportDev');
  const reader = await account('Reader');
  const listing = await submit(dev, 'Reported tool');
  const report = () => submitReport({ target: { kind: 'listing', id: listing.id }, reason: 'phishing', note: 'Asks for my password.' }, { userId: reader.id, ip: '203.0.113.9' });

  // Pending: reporting it would confirm it exists.
  await expect(report()).rejects.toMatchObject({ status: 404 });
  await act(op.id, { action: 'listing.approve', targetId: listing.id, statement: '' });
  // Visitors without an account never see listings, so they can't report one.
  await expect(submitReport({ target: { kind: 'listing', id: listing.id }, reason: 'spam' }, { userId: null, ip: '203.0.113.9' })).rejects.toMatchObject({ status: 404 });
  await report();
  const item = (await queue('open')).find((i) => i.target.kind === 'listing' && i.target.id === listing.id);
  expect(item).toMatchObject({ boardId: null, reason: 'phishing', message: 'Asks for my password.', listing: { status: 'approved', submitter: { id: dev.id } } });
});

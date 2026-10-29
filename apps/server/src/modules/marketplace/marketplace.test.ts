import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { registerOAuthApp } from '../apiauth/index';
import { createUser, getAccount } from '../auth/index';
import { decideListing, listingFor, listingsForReview, liveListings, ownListings, submitListing } from './service';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

let n = 0;
const account = async (name: string) =>
  getAccount((await createUser({ name, email: `${name.toLowerCase()}-${++n}@listings.test.freero.app`, password: 'password-123' }, { emailVerified: true })).id);
const submission = (extra: Record<string, unknown> = {}) => ({
  name: 'Standup bot',
  tagline: 'Posts yesterday’s board changes to the standup.',
  description: 'Reads your boards through the MCP server.',
  website: 'https://standup.example.com',
  category: 'agents',
  builtOn: ['mcp'],
  ...extra,
});
const noReports = async () => new Map<string, number>();

it('a pending submission is seen only by its submitter and the operators’ review list, until it is approved', async () => {
  const dev = await account('Developer');
  const other = await account('Browser');
  const listing = await submitListing(dev, submission());
  expect(listing.status).toBe('pending');

  expect((await liveListings()).map((l) => l.id)).not.toContain(listing.id);
  // Someone else asking for it by id learns nothing, not even that it exists.
  await expect(listingFor(listing.id, other.id)).rejects.toMatchObject({ status: 404 });
  await expect(listingFor('no-such-listing', other.id)).rejects.toMatchObject({ status: 404 });
  expect(await listingFor(listing.id, dev.id)).toMatchObject({ id: listing.id, status: 'pending' });
  expect((await ownListings(dev.id)).map((l) => l.id)).toEqual([listing.id]);
  expect((await listingsForReview('pending', noReports)).find((l) => l.id === listing.id)?.submitter?.id).toBe(dev.id);

  await decideListing(listing.id, 'approve', '');
  expect((await liveListings()).map((l) => l.id)).toContain(listing.id);
  // What others see of it never carries the reviewers' contact address or the review state.
  expect(await listingFor(listing.id, other.id)).not.toHaveProperty('contactEmail');

  await decideListing(listing.id, 'remove', 'Broken link.');
  await expect(listingFor(listing.id, other.id)).rejects.toMatchObject({ status: 404 });
  expect(await listingFor(listing.id, dev.id)).toMatchObject({ status: 'removed', statusNote: 'Broken link.' });
});

it('a listing’s links must be https: plain http, scripts, data and links with credentials are refused', async () => {
  const dev = await account('Linker');
  for (const bad of ['http://standup.example.com', 'javascript:alert(1)', 'data:text/html,<b>x</b>', 'https://user:secret@standup.example.com', 'https://localhost', 'standup.example.com']) {
    await expect(submitListing(dev, submission({ website: bad })), `website ${bad}`).rejects.toMatchObject({ status: 400 });
    await expect(submitListing(dev, submission({ docsUrl: bad })), `docs ${bad}`).rejects.toMatchObject({ status: 400 });
  }
  expect(await ownListings(dev.id)).toEqual([]);
});

it('a listing can name only an OAuth app its submitter registered, so nobody lists someone else’s app as theirs', async () => {
  const owner = await account('AppOwner');
  const impostor = await account('Impostor');
  const { client } = await registerOAuthApp(owner.id, { name: 'Standup bot app', redirectUris: ['https://standup.example.com/callback'] });
  const app = client.clientId;
  await expect(submitListing(impostor, submission({ oauthClientId: app }))).rejects.toMatchObject({ status: 400 });
  const own = await submitListing(owner, submission({ oauthClientId: app }));
  expect(own.oauthApp?.name).toBe('Standup bot app');
});

it('an unverified account can’t submit (a listing is published under its address, like a shared board)', async () => {
  const fresh = await getAccount((await createUser({ name: 'New', email: `new-${++n}@listings.test.freero.app`, password: 'password-123' })).id);
  await expect(submitListing(fresh, submission())).rejects.toMatchObject({ status: 403 });
});

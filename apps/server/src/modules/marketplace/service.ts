// Community listings of the Apps & agents page (#87): integrations people built on Freero's API or
// MCP. Anyone signed in with a verified address submits one; it is pending — seen only by its
// submitter and operators — until an operator approves it in the moderation console. Decisions are
// taken by modules/moderation (which records each one and its audit event) and applied here
// through `decideListing`; this module never decides anything itself.
//
// Everything a developer types is untrusted: plain text with limits (no markup is ever rendered),
// links https only, without credentials. The web app renders all of it as text.
import {
  INTEGRATION_CATEGORIES,
  type Account,
  LISTING_LIMITS,
  LISTING_SURFACES,
  MAX_LISTINGS_PER_USER,
  type CommunityListing,
  type IntegrationCategory,
  type ListingForReview,
  type ListingStatus,
  type ListingSurface,
  type ModeratedListing,
  type OwnListing,
} from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { log } from '../../platform/log';
import { appUrl, renderMail, sendMailLater } from '../../platform/mail';
import { ownOAuthApps } from '../apiauth/index';
import { getUsers, normalizeEmail, suspendedUserIds } from '../auth/index';
import * as repo from './repo';

const LIST_LIMIT = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Control characters (newlines and tabs only where a paragraph may have them) never reach a page.
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

const text = (v: unknown, field: string, { min = 0, max, multiline = false }: { min?: number; max: number; multiline?: boolean }): string => {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw badRequest(`${field} must be text`);
  const t = v.replace(/\r\n?/g, '\n').trim();
  if (CONTROL_RE.test(t) || (!multiline && /[\n\t]/.test(t))) throw badRequest(`${field} has characters that can’t be shown`);
  if (t.length < min) throw badRequest(min === 1 ? `Give your listing a ${field}` : `${field} needs at least ${min} characters`);
  if (t.length > max) throw badRequest(`${field} is too long (max ${max} characters)`);
  return t;
};

/**
 * A link a listing may carry: https only (never javascript:, data:, plain http), a real host name,
 * no user name or password in it, at most LISTING_LIMITS.url characters. Returns it normalised.
 */
export function cleanListingUrl(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw badRequest(`${field}: paste a link that starts with https://`);
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    throw badRequest(`${field}: that isn’t a link (it must start with https://)`);
  }
  if (u.protocol !== 'https:') throw badRequest(`${field} must be an https:// link`);
  if (u.username || u.password) throw badRequest(`${field} can’t carry a user name or password`);
  if (!u.hostname.includes('.') || u.hostname.endsWith('.')) throw badRequest(`${field} needs a real host name`);
  const out = u.toString();
  if (out.length > LISTING_LIMITS.url) throw badRequest(`${field} is too long`);
  return out;
}

const isCategory = (v: unknown): v is IntegrationCategory => INTEGRATION_CATEGORIES.some((c) => c.id === v);
const isSurface = (v: unknown): v is ListingSurface => LISTING_SURFACES.some((s) => s.id === v);

/** A submission as typed, checked; throws 400 naming the first field that is wrong. */
export function cleanSubmission(body: Record<string, unknown>) {
  const name = text(body.name, 'name', { min: 2, max: LISTING_LIMITS.name });
  const tagline = text(body.tagline, 'one-liner', { min: 10, max: LISTING_LIMITS.tagline });
  const description = text(body.description, 'description', { max: LISTING_LIMITS.description, multiline: true });
  const website = cleanListingUrl(body.website, 'website');
  const docsUrl = body.docsUrl === undefined || body.docsUrl === null || body.docsUrl === '' ? null : cleanListingUrl(body.docsUrl, 'docs link');
  if (!isCategory(body.category)) throw badRequest(`category must be one of ${INTEGRATION_CATEGORIES.map((c) => c.id).join(', ')}`);
  const builtOn = Array.isArray(body.builtOn) ? [...new Set(body.builtOn)] : [];
  if (!builtOn.length || !builtOn.every(isSurface)) throw badRequest(`Say what it is built on: ${LISTING_SURFACES.map((s) => s.id).join(', ')}`);
  const contact = body.contactEmail === undefined || body.contactEmail === null ? '' : normalizeEmail(text(body.contactEmail, 'contact email', { max: LISTING_LIMITS.email }));
  if (contact && !EMAIL_RE.test(contact)) throw badRequest('contact email must be an email address');
  const oauthClientId = typeof body.oauthClientId === 'string' && body.oauthClientId ? body.oauthClientId : null;
  return { name, tagline, description, website, docsUrl, category: body.category, builtOn: builtOn as ListingSurface[], contactEmail: contact || null, oauthClientId };
}

// ---- presenting ----

async function oauthAppsOf(rows: repo.ListingRow[]) {
  const apps = new Map<string, { clientId: string; name: string; website: string | null; redirectUris: string[] }>();
  for (const submitter of new Set(rows.filter((r) => r.oauthClientId).map((r) => r.submitterId)))
    for (const a of await ownOAuthApps(submitter)) apps.set(`${submitter} ${a.clientId}`, { clientId: a.clientId, name: a.name, website: a.website, redirectUris: a.redirectUris });
  // Only an app its submitter still owns: one deleted (or handed on) since shows no longer.
  return (r: repo.ListingRow) => (r.oauthClientId ? (apps.get(`${r.submitterId} ${r.oauthClientId}`) ?? null) : null);
}

async function present(rows: repo.ListingRow[]): Promise<CommunityListing[]> {
  const appOf = await oauthAppsOf(rows);
  return rows.map((r) => {
    const app = appOf(r);
    return {
      id: r.id,
      name: r.name,
      tagline: r.tagline,
      description: r.description,
      website: r.website,
      docsUrl: r.docsUrl,
      category: r.category,
      builtOn: r.builtOn,
      oauthApp: app ? { name: app.name } : null,
      featured: r.featured,
      createdAt: r.createdAt,
    };
  });
}

async function presentOwn(rows: repo.ListingRow[]): Promise<OwnListing[]> {
  const shown = await present(rows);
  return rows.map((r, i) => ({ ...shown[i], status: r.status, statusNote: r.statusNote, contactEmail: r.contactEmail, decidedAt: r.decidedAt }));
}

// ---- people ----

/** The live listings everyone signed in sees: featured first, then newest. */
export async function liveListings(): Promise<CommunityListing[]> {
  return present(await repo.byStatus('approved', LIST_LIMIT));
}

export async function ownListings(userId: string): Promise<OwnListing[]> {
  return presentOwn(await repo.ofSubmitter(userId));
}

/** One listing: a live one for anyone signed in, any of their own for its submitter; 404 otherwise (a pending one is never confirmed to exist). */
export async function listingFor(id: string, userId: string): Promise<CommunityListing | OwnListing> {
  const r = await repo.get(id);
  if (r && r.submitterId === userId) return (await presentOwn([r]))[0];
  if (r?.status === 'approved') return (await present([r]))[0];
  throw notFound('No such listing');
}

/** Files a submission (pending). Needs a verified address, like sharing a board by its link. */
export async function submitListing(user: Pick<Account, 'id' | 'emailVerified'>, body: Record<string, unknown>): Promise<OwnListing> {
  const userId = user.id;
  if (!user.emailVerified) throw new HttpError(403, 'Confirm your email address first: a link to it is in your settings.', 'email_unverified');
  const s = cleanSubmission(body);
  if (s.oauthClientId && !(await ownOAuthApps(userId)).some((a) => a.clientId === s.oauthClientId))
    throw badRequest('That OAuth app isn’t one you registered (Settings → Your OAuth apps)');
  const row: repo.ListingRow = {
    id: newId(16),
    submitterId: userId,
    status: 'pending',
    featured: false,
    ...s,
    statusNote: '',
    createdAt: Date.now(),
    decidedAt: null,
  };
  if (!(await repo.insertWithinLimit(row, MAX_LISTINGS_PER_USER)))
    throw forbidden(`You can have up to ${MAX_LISTINGS_PER_USER} listings waiting or live at once; withdraw one first`);
  log(`marketplace: listing ${row.id} submitted`);
  alertOperators(row.name);
  return (await presentOwn([row]))[0];
}

export async function withdrawListing(userId: string, id: string): Promise<void> {
  if (!(await repo.deleteOwn(id, userId))) throw notFound('No such listing');
  log(`marketplace: listing ${id} withdrawn by its submitter`);
}

/** Operators are mailed when a submission waits for review (the moderation console lists it). */
function alertOperators(name: string): void {
  const subject = `New community listing to review: “${name}”`;
  for (const to of getConfig().operatorEmails)
    sendMailLater({
      to,
      ...renderMail({
        subject,
        title: subject,
        paragraphs: ['Someone submitted an integration for the Apps & agents page. It stays hidden until you approve it.'],
        action: { label: 'Review listings', url: appUrl(null, '/operator?view=listings') },
      }),
    });
}

// ---- for modules/moderation (its operators decide; it records and audits) ----

/** A listing anyone signed in may report: only live ones (others aren't shown to reporters). */
export async function reportableListing(id: string): Promise<{ id: string; name: string } | null> {
  const r = await repo.get(id);
  return r?.status === 'approved' ? { id: r.id, name: r.name } : null;
}

/** The facts a moderation decision needs. */
export async function listingForModeration(id: string): Promise<{ id: string; name: string; submitterId: string; status: ListingStatus; featured: boolean } | null> {
  const r = await repo.get(id);
  return r ? { id: r.id, name: r.name, submitterId: r.submitterId, status: r.status, featured: r.featured } : null;
}

/** Current state of listings named in the queue (withdrawn ones are left out). */
export async function moderatedListings(ids: readonly string[]): Promise<Map<string, ModeratedListing>> {
  const rows = await repo.getMany([...new Set(ids)]);
  const [users, suspended] = await Promise.all([getUsers(rows.map((r) => r.submitterId)), suspendedUserIds(rows.map((r) => r.submitterId))]);
  return new Map(
    rows.map((r) => {
      const u = users.get(r.submitterId);
      return [r.id, { id: r.id, name: r.name, status: r.status, featured: r.featured, website: r.website, submitter: u ? { id: u.id, name: u.name, email: u.email, suspended: suspended.has(u.id) } : null }];
    }),
  );
}

export async function listingsForReview(status: ListingStatus, openReports: (ids: string[]) => Promise<Map<string, number>>): Promise<ListingForReview[]> {
  const rows = await repo.byStatus(status, LIST_LIMIT);
  const [own, appOf, users, reports] = await Promise.all([presentOwn(rows), oauthAppsOf(rows), getUsers(rows.map((r) => r.submitterId)), openReports(rows.map((r) => r.id))]);
  return rows.map((r, i) => {
    const u = users.get(r.submitterId);
    return { ...own[i], oauthApp: appOf(r), submitter: u ? { id: u.id, name: u.name, email: u.email } : null, openReports: reports.get(r.id) ?? 0 };
  });
}

export type ListingDecision = 'approve' | 'reject' | 'remove' | 'restore' | 'feature' | 'unfeature';

/**
 * Applies an operator's decision (modules/moderation calls this, then records it). Returns whether
 * anything changed: approving twice, removing a pending listing or deciding on one withdrawn
 * meanwhile change nothing. `note` is what the submitter reads with the new status.
 */
export async function decideListing(id: string, decision: ListingDecision, note: string): Promise<boolean> {
  const now = Date.now();
  switch (decision) {
    case 'approve':
      return repo.transition(id, ['pending', 'rejected'], 'approved', false, note, now);
    case 'reject':
      return repo.transition(id, ['pending'], 'rejected', false, note, now);
    case 'remove':
      return repo.transition(id, ['approved'], 'removed', false, note, now);
    case 'restore':
      return repo.transition(id, ['removed'], 'approved', false, note, now);
    case 'feature':
      return repo.setFeatured(id, true);
    case 'unfeature':
      return repo.setFeatured(id, false);
  }
}

/** The person's listings for their data export (modules/privacy). */
export async function listingsExportOf(userId: string): Promise<OwnListing[]> {
  return ownListings(userId);
}

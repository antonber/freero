// The only writer of `marketplace_listings` [S4] (community listings, #87).
import type { IntegrationCategory, ListingStatus, ListingSurface } from '@freero/shared';
import { one, query, tx } from '../../platform/db';

export interface ListingRow {
  id: string;
  submitterId: string;
  status: ListingStatus;
  featured: boolean;
  name: string;
  tagline: string;
  description: string;
  website: string;
  docsUrl: string | null;
  category: IntegrationCategory;
  builtOn: ListingSurface[];
  oauthClientId: string | null;
  contactEmail: string | null;
  statusNote: string;
  createdAt: number;
  decidedAt: number | null;
}

interface Raw {
  id: string;
  submitter_id: string;
  status: ListingStatus;
  featured: boolean;
  name: string;
  tagline: string;
  description: string;
  website: string;
  docs_url: string | null;
  category: IntegrationCategory;
  built_on: ListingSurface[];
  oauth_client_id: string | null;
  contact_email: string | null;
  status_note: string;
  created_at: Date;
  decided_at: Date | null;
}

const COLUMNS =
  'id, submitter_id, status, featured, name, tagline, description, website, docs_url, category, built_on, oauth_client_id, contact_email, status_note, created_at, decided_at';

const toRow = (r: Raw): ListingRow => ({
  id: r.id,
  submitterId: r.submitter_id,
  status: r.status,
  featured: r.featured,
  name: r.name,
  tagline: r.tagline,
  description: r.description,
  website: r.website,
  docsUrl: r.docs_url,
  category: r.category,
  builtOn: r.built_on,
  oauthClientId: r.oauth_client_id,
  contactEmail: r.contact_email,
  statusNote: r.status_note,
  createdAt: new Date(r.created_at).getTime(),
  decidedAt: r.decided_at ? new Date(r.decided_at).getTime() : null,
});

/**
 * Inserts a pending listing unless the submitter already has `max` pending or approved ones. The
 * count and the insert run under one per-submitter lock, so parallel submissions can't overshoot.
 */
export async function insertWithinLimit(l: ListingRow, max: number): Promise<boolean> {
  return tx(async (t) => {
    await t.query(`SELECT pg_advisory_xact_lock(hashtext('marketplace.quota'), hashtext($1))`, [l.submitterId]);
    const [{ n }] = await t.query<{ n: number | string }>(
      `SELECT count(*) AS n FROM marketplace_listings WHERE submitter_id = $1 AND status IN ('pending', 'approved')`,
      [l.submitterId],
    );
    if (Number(n) >= max) return false;
    await t.query(
      `INSERT INTO marketplace_listings (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        l.id,
        l.submitterId,
        l.status,
        l.featured,
        l.name,
        l.tagline,
        l.description,
        l.website,
        l.docsUrl,
        l.category,
        l.builtOn,
        l.oauthClientId,
        l.contactEmail,
        l.statusNote,
        new Date(l.createdAt),
        l.decidedAt === null ? null : new Date(l.decidedAt),
      ],
    );
    return true;
  });
}

export async function get(id: string): Promise<ListingRow | null> {
  const r = await one<Raw>(`SELECT ${COLUMNS} FROM marketplace_listings WHERE id = $1`, [id]);
  return r ? toRow(r) : null;
}

export async function getMany(ids: readonly string[]): Promise<ListingRow[]> {
  if (!ids.length) return [];
  return (await query<Raw>(`SELECT ${COLUMNS} FROM marketplace_listings WHERE id = ANY($1::text[])`, [ids])).map(toRow);
}

/** Listings in one status: featured first, then newest. */
export async function byStatus(status: ListingStatus, limit: number): Promise<ListingRow[]> {
  return (
    await query<Raw>(`SELECT ${COLUMNS} FROM marketplace_listings WHERE status = $1 ORDER BY featured DESC, created_at DESC, id LIMIT $2`, [status, limit])
  ).map(toRow);
}

export async function ofSubmitter(userId: string): Promise<ListingRow[]> {
  return (await query<Raw>(`SELECT ${COLUMNS} FROM marketplace_listings WHERE submitter_id = $1 ORDER BY created_at DESC, id`, [userId])).map(toRow);
}

/**
 * Moves a listing from one of `from` to `to` (and sets `featured`), recording the operator's note.
 * Returns whether it changed: a decision taken twice, or on a listing withdrawn meanwhile, is not.
 */
export async function transition(id: string, from: ListingStatus[], to: ListingStatus, featured: boolean, note: string, at: number): Promise<boolean> {
  const r = await one<{ id: string }>(
    `UPDATE marketplace_listings SET status = $3, featured = $4, status_note = $5, decided_at = $6
     WHERE id = $1 AND status = ANY($2::text[]) RETURNING id`,
    [id, from, to, featured, note, new Date(at)],
  );
  return r !== null;
}

/** Featuring changes nothing else; only a live listing is featured. */
export async function setFeatured(id: string, featured: boolean): Promise<boolean> {
  const r = await one<{ id: string }>(
    `UPDATE marketplace_listings SET featured = $2 WHERE id = $1 AND status = 'approved' AND featured <> $2 RETURNING id`,
    [id, featured],
  );
  return r !== null;
}

/** The submitter withdraws their own listing (any status). */
export async function deleteOwn(id: string, userId: string): Promise<boolean> {
  return (await one<{ id: string }>(`DELETE FROM marketplace_listings WHERE id = $1 AND submitter_id = $2 RETURNING id`, [id, userId])) !== null;
}

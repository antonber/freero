// Live board views inside AI assistants (MCP Apps, KAI-171). A tool call mints a single-use TICKET
// for one board (`frt_…`, EMBED_TICKET_MS to redeem); the view's page redeems it for a short-lived
// TOKEN (`fre_…`, EMBED_TOKEN_MS) that opens exactly that board's socket — never the person's
// session cookie, never the connection's own token, which stays with the assistant's host.
//
// Both act for the person through the credential that made the call, and are checked like it on
// every use: the app's consent or the personal token still there (deleting either deletes them),
// the token not paused or expired, the account not suspended or awaiting deletion, sign-in
// restrictions (enforced SSO). `maxRole` caps the person's own role by what the connection was
// granted (boards:write → editor, comments:write → commenter, else viewer), so a read-only
// connection can't use a ticket to write.
import { createHash, randomBytes } from 'node:crypto';
import type { Account, Role } from '@freero/shared';
import { newId } from '../../platform/ids';
import { getAccount, isSuspended, signInRestriction } from '../auth/index';
import type { ApiCredential } from './credentials';
import * as repo from './repo';

export const EMBED_TICKET_PREFIX = 'frt_';
export const EMBED_TOKEN_PREFIX = 'fre_';
/** A ticket waits this long for its view to load (hosts render views lazily). */
export const EMBED_TICKET_MS = 10 * 60_000;
/** A redeemed view's token lasts this long; its socket is closed then (the view asks again). */
export const EMBED_TOKEN_MS = 60 * 60_000;

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/** The role a credential's live view may have at most (its own role on the board caps it too). */
export function embedRoleFor(cred: Pick<ApiCredential, 'scopes'>): repo.EmbedRole {
  if (cred.scopes.includes('boards:write')) return 'editor';
  if (cred.scopes.includes('comments:write')) return 'commenter';
  return 'viewer';
}

/** A ticket for one live view of `boardId`, acting for the credential's person. */
export async function mintEmbedTicket(cred: ApiCredential, boardId: string): Promise<{ ticket: string; expiresAt: number; maxRole: repo.EmbedRole }> {
  const ticket = EMBED_TICKET_PREFIX + randomBytes(32).toString('base64url');
  const now = Date.now();
  const maxRole = embedRoleFor(cred);
  await repo.insertEmbedTicket({
    id: newId(16),
    userId: cred.account.id,
    boardId,
    maxRole,
    credentialId: cred.credentialId,
    label: cred.label,
    grantId: cred.kind === 'oauth' ? cred.grantId : null,
    personalTokenId: cred.kind === 'personal' ? cred.tokenId : null,
    issuedVia: cred.issuedVia,
    ticketHash: hash(ticket),
    ticketExpiresAt: now + EMBED_TICKET_MS,
    expiresAt: now + EMBED_TICKET_MS + EMBED_TOKEN_MS,
    createdAt: now,
  });
  return { ticket, expiresAt: now + EMBED_TICKET_MS, maxRole };
}

/** Who a live view acts for, and what it may open. */
export interface EmbedSession {
  /** realtime's session key for its socket (`embed:<sha256>`): ending it closes the socket. */
  sessionKey: string;
  boardId: string;
  maxRole: Role;
  expiresAt: number;
  /** The connection it acts through (its workspace switch and blocks apply). */
  cred: ApiCredential;
}

export const EMBED_SESSION_PREFIX = 'embed:';

async function sessionOf(row: repo.EmbedRow, tokenHash: string, now: number): Promise<EmbedSession | null> {
  if (row.expiresAt <= now) return null;
  if (row.personalTokenId && (row.parentPausedAt !== null || (row.parentExpiresAt !== null && row.parentExpiresAt <= now))) return null;
  let account: Account;
  try {
    account = await getAccount(row.userId);
  } catch {
    return null;
  }
  if (account.deletionScheduledFor !== null || (await isSuspended(account.id))) return null;
  if (await signInRestriction({ email: account.email, userId: account.id, method: row.issuedVia })) return null;
  return {
    sessionKey: EMBED_SESSION_PREFIX + tokenHash,
    boardId: row.boardId,
    maxRole: row.maxRole,
    expiresAt: row.expiresAt,
    cred: {
      tokenId: row.id,
      credentialId: row.credentialId,
      kind: row.grantId ? 'oauth' : 'personal',
      label: row.label,
      clientId: row.clientId,
      scopes: [],
      account,
      grantId: row.grantId,
      issuedVia: row.issuedVia,
    },
  };
}

/** Redeems a ticket (once) for a view token; null when it is unknown, used, late or no longer valid. */
export async function redeemEmbedTicket(ticket: string): Promise<{ token: string; session: EmbedSession } | null> {
  if (typeof ticket !== 'string' || !ticket.startsWith(EMBED_TICKET_PREFIX) || ticket.length > 200) return null;
  const token = EMBED_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const now = Date.now();
  const row = await repo.redeemEmbedTicket(hash(ticket), hash(token), now);
  const session = row && (await sessionOf(row, hash(token), now));
  return session ? { token, session } : null;
}

/** The live view a token opens, checked afresh; null when it no longer may. */
export async function authenticateEmbed(token: string): Promise<EmbedSession | null> {
  if (typeof token !== 'string' || !token.startsWith(EMBED_TOKEN_PREFIX) || token.length > 200) return null;
  const tokenHash = hash(token);
  const row = await repo.embedByTokenHash(tokenHash);
  return row ? sessionOf(row, tokenHash, Date.now()) : null;
}

/** The live view behind a socket's session key (`embed:<sha256>`), checked afresh; null when it no longer may. */
export async function authenticateEmbedKey(sessionKey: string): Promise<EmbedSession | null> {
  if (!sessionKey.startsWith(EMBED_SESSION_PREFIX)) return null;
  const tokenHash = sessionKey.slice(EMBED_SESSION_PREFIX.length);
  const row = await repo.embedByTokenHash(tokenHash);
  return row ? sessionOf(row, tokenHash, Date.now()) : null;
}

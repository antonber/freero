// Which Freero account a provider sign-in belongs to. The rules:
// - A provider account (issuer + subject) signs in to the account it is connected to.
// - It is connected automatically only to the account whose address the provider asserts as
//   VERIFIED (and, when that account has two-factor on, only after its second step — see signIn.ts).
// - An address the provider doesn't vouch for never matches an existing account; it may start a
//   new (unverified) one if nobody uses it.
// - Signed in, anyone can connect a provider account that is not connected elsewhere.
import type { Request } from 'express';
import type { LinkedIdentity, OidcErrorCode, SignInProvider } from '@freero/shared';
import { getConfig, type OidcProviderConfig } from '../../platform/config';
import { HttpError } from '../../platform/http';
import { newId } from '../../platform/ids';
import { sendSecurityNotice } from './notices';
import { auditOwnAccount } from './service';
import type { ProviderClaims } from './oidc';
import * as repo from './repo';
import { endSessionsOf, insertAccount, markEmailVerified, normalizeEmail, validEmail } from './service';

export function providerConfig(id: string): OidcProviderConfig | null {
  return getConfig().oidcProviders.find((p) => p.id === id) ?? null;
}

export function configuredProviders(): SignInProvider[] {
  return getConfig().oidcProviders.map((p) => ({ id: p.id, label: p.label }));
}

/** Identities and sessions of a workspace's single sign-on use the provider id `sso:<workspaceId>`. */
export const DIRECTORY_PROVIDER_PREFIX = 'sso:';

/** The button label of a provider id (also for one no longer configured). */
export function providerLabel(id: string): string {
  if (id.startsWith(DIRECTORY_PROVIDER_PREFIX)) return 'Single sign-on';
  return providerConfig(id)?.label ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export function toLinkedIdentity(i: repo.IdentityRecord): LinkedIdentity {
  return { id: i.id, provider: i.provider, providerLabel: providerLabel(i.provider), email: i.email, createdAt: i.createdAt, lastUsedAt: i.lastUsedAt };
}

const linkOf = (provider: string, c: ProviderClaims, email: string | null): repo.PendingLink => ({
  provider,
  issuer: c.issuer,
  subject: c.subject,
  email,
  emailVerified: c.emailVerified,
});

export type ProviderLogin =
  /** `link`: connect this identity when the sign-in completes (after the second step, if any). */
  | { userId: string; link: repo.PendingLink | null; created: boolean }
  | { error: OidcErrorCode };

/** Resolves a provider sign-in to an account: the connected one, a verified-email match, or a new one. */
export async function resolveProviderLogin(provider: string, c: ProviderClaims, retried = false): Promise<ProviderLogin> {
  const existing = await repo.findIdentity(provider, c.issuer, c.subject);
  if (existing) {
    await repo.touchIdentity(existing.id, c.email, c.emailVerified, Date.now());
    return { userId: existing.userId, link: null, created: false };
  }
  const email = c.email ? normalizeEmail(c.email) : '';
  if (!email || !validEmail(email)) return { error: 'no_email' };
  const user = await repo.findUserByEmail(email);
  if (user) return c.emailVerified ? { userId: user.id, link: linkOf(provider, c, email), created: false } : { error: 'email_in_use' };
  const name = (c.name ?? email.split('@')[0]).slice(0, 80);
  try {
    const account = await insertAccount({ name, email, passwordHash: null, emailVerified: c.emailVerified }, linkOf(provider, c, email));
    return { userId: account.id, link: null, created: true };
  } catch (e) {
    // A concurrent sign-up took the address, or a concurrent first sign-in created this very
    // identity: resolve again against what exists now.
    if (!retried && (e instanceof repo.IdentityTakenError || (e instanceof HttpError && e.status === 409)))
      return resolveProviderLogin(provider, c, true);
    throw e;
  }
}

/**
 * A workspace's own identity provider (single sign-on, modules/sso). The caller has checked that
 * the asserted address is at a domain the workspace proved it controls (DNS), so the provider is
 * the authority for it: an existing account with that address is reached (connected after its
 * second step, like a vouched provider sign-in) and otherwise one is made, verified. The identity
 * (`provider` = 'sso:<workspaceId>', issuer, subject) keeps signing in to the same account.
 */
export async function resolveDirectoryLogin(
  provider: string,
  c: { issuer: string; subject: string; email: string; name: string | null },
  retried = false,
): Promise<{ userId: string; link: repo.PendingLink | null; created: boolean }> {
  const existing = await repo.findIdentity(provider, c.issuer, c.subject);
  if (existing) {
    await repo.touchIdentity(existing.id, c.email, true, Date.now());
    return { userId: existing.userId, link: null, created: false };
  }
  const email = normalizeEmail(c.email);
  if (!validEmail(email)) throw new HttpError(400, 'The identity provider sent no usable email address');
  const claims: ProviderClaims = { issuer: c.issuer, subject: c.subject, email, emailVerified: true, name: c.name };
  const user = await repo.findUserByEmail(email);
  if (user) return { userId: user.id, link: linkOf(provider, claims, email), created: false };
  try {
    const account = await insertAccount(
      { name: (c.name ?? email.split('@')[0]).slice(0, 80), email, passwordHash: null, emailVerified: true },
      linkOf(provider, claims, email),
    );
    return { userId: account.id, link: null, created: true };
  } catch (e) {
    if (!retried && (e instanceof repo.IdentityTakenError || (e instanceof HttpError && e.status === 409)))
      return resolveDirectoryLogin(provider, c, true);
    throw e;
  }
}

/**
 * Provisioning (SCIM): the account of an address at a domain the workspace proved it controls —
 * the existing one, or a new passwordless, verified one (its owner signs in through the
 * workspace's single sign-on, or sets a password with a reset link).
 */
export async function provisionDirectoryAccount(emailIn: string, name: string | null): Promise<{ userId: string; created: boolean }> {
  const email = normalizeEmail(emailIn);
  if (!validEmail(email)) throw new HttpError(400, 'Not a valid email address');
  const user = await repo.findUserByEmail(email);
  if (user) return { userId: user.id, created: false };
  try {
    const account = await insertAccount({ name: (name?.trim() || email.split('@')[0]).slice(0, 80), email, passwordHash: null, emailVerified: true });
    return { userId: account.id, created: true };
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) {
      const raced = await repo.findUserByEmail(email);
      if (raced) return { userId: raced.id, created: false };
    }
    throw e;
  }
}

/**
 * Connects a provider identity to the account (a sign-in that matched it by verified email, after
 * any second step). If the account's own address was never verified, the provider just proved it
 * belongs to the person signing in now — not necessarily to whoever created the account with it: a
 * password, sessions and pending email links set up by someone else stop working.
 */
export async function connectIdentity(req: Request | null, userId: string, link: repo.PendingLink): Promise<void> {
  const user = await repo.findUserById(userId);
  if (!user) throw new HttpError(401, 'Not logged in');
  try {
    await repo.insertIdentity({ id: newId(), userId, ...link, createdAt: Date.now() });
  } catch (e) {
    // Connected meanwhile (a parallel sign-in): fine, it signs in to this account either way.
    if (e instanceof repo.IdentityTakenError && (await repo.findIdentity(link.provider, link.issuer, link.subject))?.userId === userId) return;
    if (e instanceof repo.ProviderAlreadyLinkedError)
      throw new HttpError(409, `This account is already connected to another ${providerLabel(link.provider)} account`);
    throw e;
  }
  if (link.emailVerified && link.email === user.email && !user.emailVerified) {
    await repo.setPasswordHash(userId, null);
    await repo.deleteTokens(userId, 'change_email');
    await repo.deleteTokens(userId, 'reset_password');
    await endSessionsOf(userId);
    await markEmailVerified(userId, user.email);
  }
  await auditOwnAccount('auth.provider_connected', userId, { provider: link.provider, providerEmail: link.email });
  sendSecurityNotice(req, user.email, { kind: 'provider_connected', provider: providerLabel(link.provider), providerEmail: link.email });
}

/** Signed in: connect another sign-in method. Returns an error code, or null when connected. */
export async function linkProvider(req: Request | null, userId: string, provider: string, c: ProviderClaims): Promise<OidcErrorCode | null> {
  const existing = await repo.findIdentity(provider, c.issuer, c.subject);
  if (existing) return existing.userId === userId ? null : 'identity_in_use';
  const email = c.email ? normalizeEmail(c.email) : null;
  try {
    await repo.insertIdentity({ id: newId(), userId, ...linkOf(provider, c, email), createdAt: Date.now() });
  } catch (e) {
    if (e instanceof repo.ProviderAlreadyLinkedError) return 'provider_linked';
    if (e instanceof repo.IdentityTakenError) return 'identity_in_use';
    throw e;
  }
  // The provider vouches for the account's own address: that verifies it too.
  if (email && c.emailVerified) await markEmailVerified(userId, email);
  const user = await repo.findUserById(userId);
  await auditOwnAccount('auth.provider_connected', userId, { provider, providerEmail: email });
  if (user) sendSecurityNotice(req, user.email, { kind: 'provider_connected', provider: providerLabel(provider), providerEmail: email });
  return null;
}

/** Signed in: the provider account that re-confirmed must be one connected to this account. */
export async function isConnectedIdentity(userId: string, provider: string, c: ProviderClaims): Promise<boolean> {
  return (await repo.findIdentity(provider, c.issuer, c.subject))?.userId === userId;
}

export async function disconnectIdentity(req: Request | null, userId: string, id: string): Promise<void> {
  const identity = (await repo.listIdentities(userId)).find((i) => i.id === id);
  const r = identity ? await repo.deleteIdentityIfNotLast(userId, id) : 'missing';
  if (r === 'missing') throw new HttpError(404, 'That sign-in method is not connected');
  if (r === 'last') throw new HttpError(409, 'Set a password first: this is your only way to log in');
  const user = await repo.findUserById(userId);
  await auditOwnAccount('auth.provider_disconnected', userId, { provider: identity!.provider });
  if (user) sendSecurityNotice(req, user.email, { kind: 'provider_disconnected', provider: providerLabel(identity!.provider) });
}

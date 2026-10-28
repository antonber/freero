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
import type { ProviderClaims } from './oidc';
import * as repo from './repo';
import { endSessionsOf, insertAccount, markEmailVerified, normalizeEmail, validEmail } from './service';

export function providerConfig(id: string): OidcProviderConfig | null {
  return getConfig().oidcProviders.find((p) => p.id === id) ?? null;
}

export function configuredProviders(): SignInProvider[] {
  return getConfig().oidcProviders.map((p) => ({ id: p.id, label: p.label }));
}

/** The button label of a provider id (also for one no longer configured). */
export function providerLabel(id: string): string {
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
    throw e;
  }
  if (link.emailVerified && link.email === user.email && !user.emailVerified) {
    await repo.setPasswordHash(userId, null);
    await repo.deleteTokens(userId, 'change_email');
    await repo.deleteTokens(userId, 'reset_password');
    await endSessionsOf(userId);
    await markEmailVerified(userId, user.email);
  }
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
  if (user) sendSecurityNotice(req, user.email, { kind: 'provider_disconnected', provider: providerLabel(identity!.provider) });
}

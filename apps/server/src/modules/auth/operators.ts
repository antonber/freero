// Freero's operators: a VERIFIED address listed in OPERATOR_EMAILS, never a database flag (someone
// who signs up with an operator's address gets nothing until they prove it). They review abuse
// reports (modules/moderation) and problem reports (modules/problems); their APIs answer 404 to
// everyone else, and the `problems:triage` API scope can only be granted to, and only works for,
// them (modules/apiauth).
import type { Account } from '@freero/shared';
import { getConfig } from '../../platform/config';
import * as repo from './repo';

export function isOperator(user: Pick<Account, 'email' | 'emailVerified'>): boolean {
  return user.emailVerified && getConfig().operatorEmails.includes(user.email.toLowerCase());
}

/** Whether this account is one of Freero's operators (for callers that have only its id). */
export async function isOperatorAccount(userId: string): Promise<boolean> {
  if (!getConfig().operatorEmails.length) return false;
  const user = await repo.findUserById(userId);
  return !!user && isOperator(user);
}

/**
 * An address under a name reserved for tests and documentation (RFC 2606, RFC 6761): example.com,
 * .net and .org and the .test, .example, .invalid and .localhost top-level names. No person's
 * mail lives there; the deploy smoke test signs up as smoke-…@example.com.
 */
export function isTestAddress(email: string): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase().replace(/\.$/, '');
  return /(^|\.)example\.(com|net|org)$/.test(domain) || /(^|\.)(test|example|invalid|localhost)$/.test(domain);
}

/**
 * Who an account is to product analytics: `test` (an address of isTestAddress: nothing is sent),
 * `internal` (one of Freero's operators: sent, marked internal so reports can leave it out) or
 * `person`. An account that no longer exists is a person: its last events still count.
 */
export async function analyticsAudienceOf(userId: string): Promise<'person' | 'internal' | 'test'> {
  const user = await repo.findUserById(userId);
  if (!user) return 'person';
  if (isTestAddress(user.email)) return 'test';
  return isOperator(user) ? 'internal' : 'person';
}

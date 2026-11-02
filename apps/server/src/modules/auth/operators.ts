// Freero's operators: a VERIFIED address listed in OPERATOR_EMAILS, never a database flag (someone
// who signs up with an operator's address gets nothing until they prove it). They review abuse
// reports (modules/moderation) and problem reports (modules/problems); their APIs answer 404 to
// everyone else, and the `problems:triage` API scope can only be granted to, and only works for,
// them (modules/apiauth).
import type { Account } from '@freero/shared';
import { getConfig } from '../../platform/config';

export function isOperator(user: Pick<Account, 'email' | 'emailVerified'>): boolean {
  return user.emailVerified && getConfig().operatorEmails.includes(user.email.toLowerCase());
}

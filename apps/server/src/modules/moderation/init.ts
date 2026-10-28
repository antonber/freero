import type { ServerContext } from '../../platform/context';
import { log } from '../../platform/log';

/** A public deployment needs someone reading reports; say so at startup when nobody would. */
export default function moderationInit(ctx: ServerContext): void {
  const { production, operatorEmails, abuseContactEmail } = ctx.config;
  if (!production) return;
  if (!operatorEmails.length) log('moderation: OPERATOR_EMAILS is empty — reports are collected, but nobody can review them');
  if (!abuseContactEmail) log('moderation: ABUSE_CONTACT_EMAIL is not set — notices give no contact address');
  if (!ctx.config.securityContact) log('moderation: neither SECURITY_CONTACT nor ABUSE_CONTACT_EMAIL is set — /.well-known/security.txt is not served');
}

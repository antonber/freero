import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { log } from '../../platform/log';
import { purgeExpiredKeptCopies } from './service';

const KEPT_COPIES_LOCK_KEY = 7_202_610_311; // arbitrary, constant across releases

/** A public deployment needs someone reading reports; say so at startup when nobody would. */
export default function moderationInit(ctx: ServerContext): void {
  // Kept copies of removed files expire (KAI-179).
  scheduleExclusiveJob(ctx, {
    name: 'moderation:kept-copies',
    lockKey: KEPT_COPIES_LOCK_KEY,
    intervalMs: ctx.config.moderationRetentionIntervalMs,
    run: async () => {
      const n = await purgeExpiredKeptCopies();
      if (n) log(`moderation: deleted ${n} kept cop${n === 1 ? 'y' : 'ies'} of removed files past MODERATION_KEEP_REMOVED_DAYS`);
    },
  });
  const { production, operatorEmails, abuseContactEmail } = ctx.config;
  if (!production) return;
  if (!operatorEmails.length) log('moderation: OPERATOR_EMAILS is empty — reports are collected, but nobody can review them');
  if (!abuseContactEmail) log('moderation: ABUSE_CONTACT_EMAIL is not set — notices give no contact address');
  if (!ctx.config.securityContact) log('moderation: neither SECURITY_CONTACT nor ABUSE_CONTACT_EMAIL is set — /.well-known/security.txt is not served');
}

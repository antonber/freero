// Operator commands of modules/auth (reserved file, discovered by apps/server/src/admin.ts).
// The procedure around them — the identity check before a reset — is in docs/operations.md.
import { DISCOVERY_SOURCES, type DiscoverySource } from '@freero/shared';
import { AdminUsageError, requiredFlag, type AdminArgs, type AdminCommand } from '../../platform/admin';
import { accountSecuritySummary, resetTwoFactorByOperator, type AccountSecuritySummary } from './recovery';
import { discoverySourceCounts } from './signups';

const iso = (ms: number | null) => (ms === null ? '—' : new Date(ms).toISOString());

function describe(s: AccountSecuritySummary): string[] {
  return [
    `account        ${s.id}`,
    `email          ${s.email} (${s.emailVerified ? 'verified' : 'NOT verified'})`,
    `created        ${iso(s.createdAt)}`,
    `password       ${s.hasPassword ? 'set' : 'none'}`,
    `two-step       ${s.twoFactorEnabledAt === null ? 'off' : `on since ${iso(s.twoFactorEnabledAt)} (${s.recoveryCodesLeft} recovery codes left)`}`,
    `recovery       ${s.recovery ? `in progress since ${iso(s.recovery.startedAt)}, ready ${iso(s.recovery.readyAt)}` : 'none'}`,
    `providers      ${s.identities}`,
    `sessions       ${s.sessions}`,
    ...(s.pendingRevertEmail
      ? ['WARNING        the address was changed recently and the previous address can still undo it: the current address may not be the owner’s']
      : []),
  ];
}

/** The sign-up form's answers as the operator reads them (the form's own wording is translated, this isn't). */
const SOURCE_LABEL: Record<DiscoverySource, string> = {
  search: 'Search engine',
  ai_assistant: 'AI assistant',
  colleague: 'A colleague or friend',
  social: 'Social media',
  open_source: 'GitHub or open-source community',
  directory: 'A directory or review site',
  other: 'Other',
};
const DAY = 24 * 60 * 60 * 1000;

/** `--since` / `--until` (YYYY-MM-DD, UTC; `--until` is inclusive): the last 30 days by default. */
function periodOf(args: AdminArgs, now = Date.now()): { since: number; until: number } {
  const day = (name: string): number | undefined => {
    const v = args.flags[name];
    if (v === undefined) return undefined;
    const at = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00Z`) : NaN;
    if (Number.isNaN(at)) throw new AdminUsageError(`--${name} takes a date: YYYY-MM-DD`);
    return at;
  };
  const until = (day('until') ?? Math.floor(now / DAY) * DAY) + DAY;
  const since = day('since') ?? until - 30 * DAY;
  if (since >= until) throw new AdminUsageError('--since must be on or before --until');
  return { since, until };
}

/** The table `signups:sources` prints. */
export function discoveryReport(period: { since: number; until: number }, counts: Awaited<ReturnType<typeof discoverySourceCounts>>): string[] {
  const answered = counts.total - counts.none;
  const pct = (n: number) => (answered ? `${Math.round((n * 100) / answered)}%` : '—').padStart(5);
  const width = Math.max(...Object.values(SOURCE_LABEL).map((l) => l.length));
  return [
    `Sign-ups ${iso(period.since).slice(0, 10)} to ${iso(period.until - DAY).slice(0, 10)} (UTC): ${counts.total} account(s), ${answered} answered “How did you find Freero?”`,
    '',
    ...DISCOVERY_SOURCES.map((s) => `  ${SOURCE_LABEL[s].padEnd(width)}  ${String(counts.answers[s]).padStart(6)}  ${pct(counts.answers[s])}`),
    `  ${'No answer'.padEnd(width)}  ${String(counts.none).padStart(6)}`,
    '',
    'Percentages are of the answers. “No answer”: skipped, or the account was made without the form (Google, Microsoft, single sign-on, a directory), which doesn’t ask. Deleted accounts are not counted.',
  ];
}

async function summaryOf(args: AdminArgs): Promise<AccountSecuritySummary> {
  const email = args.positional[0];
  if (!email) throw new AdminUsageError('Give the account’s email address');
  const s = await accountSecuritySummary(email);
  if (!s) throw new AdminUsageError(`No account uses ${email}`);
  return s;
}

export default function authAdmin(): AdminCommand[] {
  return [
    {
      name: 'signups:sources',
      usage: '[--since YYYY-MM-DD] [--until YYYY-MM-DD]',
      summary:
        'Counts the accounts created in the period (UTC days; the last 30 by default) by their answer to “How did you find Freero?” on the sign-up form. Changes nothing.',
      async run(args) {
        if (args.positional.length) throw new AdminUsageError(`Unexpected ${args.positional.join(' ')}`);
        const period = periodOf(args);
        for (const line of discoveryReport(period, await discoverySourceCounts(period.since, period.until))) args.print(line);
      },
    },
    {
      name: 'account:show',
      usage: '<email>',
      summary: 'Shows an account’s sign-in security (two-step, recovery in progress, providers, sessions). Changes nothing.',
      async run(args) {
        for (const line of describe(await summaryOf(args))) args.print(line);
      },
    },
    {
      name: 'two-factor:reset',
      usage: '<email> --operator <your name> --reason <ticket / how identity was checked> [--yes]',
      summary:
        'After an out-of-band identity check (docs/operations.md): removes two-step verification, the password and every provider sign-in, ends every session and mails the owner a way to choose a new password. Without --yes it only shows the account.',
      async run(args) {
        const operator = requiredFlag(args, 'operator', 'your name');
        const reason = requiredFlag(args, 'reason', 'ticket / how identity was checked');
        const s = await summaryOf(args);
        for (const line of describe(s)) args.print(line);
        if (args.flags.yes !== true) {
          args.print('');
          args.print('Nothing changed. Re-run with --yes to reset two-step verification for this account.');
          return;
        }
        await resetTwoFactorByOperator(s.id, operator, reason);
        args.print('');
        args.print(`Done: two-step verification, password and provider sign-ins removed; ${s.sessions} session(s) ended; ${s.email} was mailed how to choose a new password.`);
        args.print('Their open board tabs are disconnected: at once with REDIS_URL, otherwise within SESSION_RECHECK_SECONDS.');
      },
    },
  ];
}

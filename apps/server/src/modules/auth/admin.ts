// Operator commands of modules/auth (reserved file, discovered by apps/server/src/admin.ts).
// The procedure around them — the identity check before a reset — is in docs/operations.md.
import { AdminUsageError, requiredFlag, type AdminArgs, type AdminCommand } from '../../platform/admin';
import { accountSecuritySummary, resetTwoFactorByOperator, type AccountSecuritySummary } from './recovery';

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

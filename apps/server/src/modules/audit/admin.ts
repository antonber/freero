// Operator commands of modules/audit (reserved file, discovered by apps/server/src/admin.ts).
// Loading it also connects the audit log in the CLI process, so what other commands record
// through platform/audit.ts (an operator's two-step reset) lands in the audit log too.
import type { ServerContext } from '../../platform/context';
import { AdminUsageError, type AdminCommand } from '../../platform/admin';
import { verifyChain } from './service';
import { connectAudit } from './wiring';

export default function auditAdmin(ctx: ServerContext): AdminCommand[] {
  const disconnect = connectAudit();
  ctx.onShutdown(() => void disconnect());
  return [
    {
      name: 'audit:verify',
      usage: '<workspace id | w:<workspace id> | u:<user id>>',
      summary: 'Re-checks the hash chain of a workspace’s (or an account’s) audit log. Changes nothing.',
      async run(args) {
        const arg = args.positional[0];
        if (!arg) throw new AdminUsageError('Give a workspace id, or a chain (w:<id> / u:<id>)');
        const chain = /^[wu]:/.test(arg) ? arg : `w:${arg}`;
        const r = await verifyChain(chain);
        const iso = (ms: number | null) => (ms === null ? '—' : new Date(ms).toISOString());
        args.print(`chain     ${chain}`);
        args.print(`events    ${r.events} (${iso(r.firstAt)} – ${iso(r.lastAt)})`);
        args.print(`head      ${r.headHash ?? '—'}`);
        args.print(r.ok ? 'intact    yes' : `intact    NO: ${r.problem}`);
        if (!r.ok) throw new Error(`the audit log ${chain} is not intact`);
      },
    },
  ];
}

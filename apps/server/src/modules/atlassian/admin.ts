// Operator command of modules/atlassian (reserved file, discovered by apps/server/src/admin.ts): the
// Forge app's source for this instance, written to a zip to deploy with Atlassian's `forge`
// command (docs/integrations/atlassian.md).
import fs from 'node:fs';
import { AdminUsageError, type AdminCommand } from '../../platform/admin';
import type { ServerContext } from '../../platform/context';
import { packageOrigin } from '../../platform/hostApps';
import { forgeAppPackage } from './forge';

export default function atlassianAdmin(ctx: ServerContext): AdminCommand[] {
  return [
    {
      name: 'atlassian:package',
      usage: '[--out freero-atlassian.zip] [--url https://your-freero.example]',
      summary: 'Writes the Atlassian Forge app (Confluence macro, Jira issue panel) for ATLASSIAN_APP_ID, pointing at PUBLIC_URL or --url.',
      async run(args) {
        const atlassian = ctx.config.atlassian;
        if (!atlassian) throw new AdminUsageError('Set ATLASSIAN_APP_ID first (your Forge app’s id; see docs/integrations/atlassian.md)');
        let origin: string;
        try {
          origin = packageOrigin(typeof args.flags.url === 'string' ? args.flags.url : ctx.config.publicUrl, 'Atlassian');
        } catch (e) {
          throw new AdminUsageError(`${(e as Error).message} (or give --url https://…)`);
        }
        const file = typeof args.flags.out === 'string' && args.flags.out ? args.flags.out : 'freero-atlassian.zip';
        fs.writeFileSync(file, forgeAppPackage(origin, atlassian.appId));
        args.print(`Wrote ${file}: unzip it, then npm install, npm run build, forge deploy, forge install`);
      },
    },
  ];
}

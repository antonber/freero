// Operator commands of modules/slack (reserved file, discovered by apps/server/src/admin.ts).
import { AdminUsageError, type AdminCommand } from '../../platform/admin';
import type { ServerContext } from '../../platform/context';
import { slackAppManifest } from './manifest';

export default function slackAdmin(ctx: ServerContext): AdminCommand[] {
  return [
    {
      name: 'slack:manifest',
      usage: '[--url https://your-freero.example]',
      summary: 'Prints the Slack app manifest for link unfurls (paste it into "Create New App → From a manifest"), for PUBLIC_URL or --url.',
      async run(args) {
        const url = typeof args.flags.url === 'string' ? args.flags.url : ctx.config.publicUrl;
        if (!url || !/^https:\/\//.test(url)) throw new AdminUsageError('Slack needs an https address: set PUBLIC_URL, or give --url https://…');
        args.print(JSON.stringify(slackAppManifest(url), null, 2));
      },
    },
  ];
}

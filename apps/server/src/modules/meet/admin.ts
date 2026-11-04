// Operator command of modules/meet (reserved file, discovered by apps/server/src/admin.ts): the Google
// Meet add-on's deployment manifest for this instance (docs/integrations/google-meet.md).
import fs from 'node:fs';
import { AdminUsageError, type AdminCommand } from '../../platform/admin';
import type { ServerContext } from '../../platform/context';
import { packageOrigin } from '../../platform/hostApps';
import { meetDeployment } from './deployment';

export default function meetAdmin(ctx: ServerContext): AdminCommand[] {
  return [
    {
      name: 'meet:deployment',
      usage: '[--out freero-meet-deployment.json] [--url https://your-freero.example]',
      summary: 'Writes the Google Meet add-on deployment manifest (side panel, origins, logo) for GOOGLE_MEET_CLOUD_PROJECT_NUMBER, pointing at PUBLIC_URL or --url.',
      async run(args) {
        if (!ctx.config.meet) throw new AdminUsageError('Set GOOGLE_MEET_CLOUD_PROJECT_NUMBER first (your Google Cloud project’s number; see docs/integrations/google-meet.md)');
        let origin: string;
        try {
          origin = packageOrigin(typeof args.flags.url === 'string' ? args.flags.url : ctx.config.publicUrl, 'Google Meet');
        } catch (e) {
          throw new AdminUsageError(`${(e as Error).message} (or give --url https://…)`);
        }
        const file = typeof args.flags.out === 'string' && args.flags.out ? args.flags.out : 'freero-meet-deployment.json';
        fs.writeFileSync(file, `${JSON.stringify(meetDeployment(origin), null, 2)}\n`);
        args.print(`Wrote ${file}: paste it into Google Workspace Marketplace SDK → HTTP deployments → Create new deployment`);
      },
    },
  ];
}

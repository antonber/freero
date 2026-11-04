// Operator command of modules/zoom (reserved file, discovered by apps/server/src/admin.ts): the
// values to enter for this instance's Zoom App in the Zoom App Marketplace (docs/integrations/zoom.md).
import fs from 'node:fs';
import { AdminUsageError, type AdminCommand } from '../../platform/admin';
import type { ServerContext } from '../../platform/context';
import { packageOrigin } from '../../platform/hostApps';
import { zoomAppSettings } from './settings';

export default function zoomAdmin(ctx: ServerContext): AdminCommand[] {
  return [
    {
      name: 'zoom:settings',
      usage: '[--out freero-zoom.json] [--url https://your-freero.example]',
      summary: 'Writes what to enter for the Zoom App (home URL, domain allow list, redirect URL, Zoom App SDK APIs) for ZOOM_CLIENT_ID, pointing at PUBLIC_URL or --url.',
      async run(args) {
        const zoom = ctx.config.zoom;
        if (!zoom) throw new AdminUsageError('Set ZOOM_CLIENT_ID first (your Zoom app’s Client ID; see docs/integrations/zoom.md)');
        let origin: string;
        try {
          origin = packageOrigin(typeof args.flags.url === 'string' ? args.flags.url : ctx.config.publicUrl, 'Zoom');
        } catch (e) {
          throw new AdminUsageError(`${(e as Error).message} (or give --url https://…)`);
        }
        const file = typeof args.flags.out === 'string' && args.flags.out ? args.flags.out : 'freero-zoom.json';
        fs.writeFileSync(file, `${JSON.stringify(zoomAppSettings(origin, zoom.clientId), null, 2)}\n`);
        args.print(`Wrote ${file}`);
      },
    },
  ];
}

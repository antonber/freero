// Operator commands of modules/teams (reserved file, discovered by apps/server/src/admin.ts): the
// Microsoft 365 app packages of this instance, written to a file to upload in the Teams admin
// center, the Teams Developer Portal or Partner Center (docs/integrations/teams.md).
import fs from 'node:fs';
import { AdminUsageError, type AdminCommand } from '../../platform/admin';
import type { ServerContext } from '../../platform/context';
import { copilotAgentPackage } from './copilot';
import { packageOrigin, SEMVER, TEAMS_APP_VERSION, teamsAppPackage } from './manifest';

export default function teamsAdmin(ctx: ServerContext): AdminCommand[] {
  const originFrom = (flag: unknown) => {
    try {
      return packageOrigin(typeof flag === 'string' ? flag : ctx.config.publicUrl);
    } catch (e) {
      throw new AdminUsageError(`${(e as Error).message} (or give --url https://…)`);
    }
  };
  const out = (flag: unknown, fallback: string) => (typeof flag === 'string' && flag ? flag : fallback);
  const versionFrom = (flag: unknown) => {
    if (flag === undefined) return TEAMS_APP_VERSION;
    if (typeof flag !== 'string' || !SEMVER.test(flag)) throw new AdminUsageError('--version must look like 1.2.3 (higher than the package uploaded before)');
    return flag;
  };
  return [
    {
      name: 'teams:package',
      usage: '[--out freero-teams.zip] [--url https://your-freero.example] [--version 1.0.1]',
      summary: 'Writes the Microsoft Teams app package (manifest and icons) for TEAMS_APP_ID (and TEAMS_BOT_ID for link previews), pointing at PUBLIC_URL or --url.',
      async run(args) {
        const teams = ctx.config.teams;
        if (!teams) throw new AdminUsageError('Set TEAMS_APP_ID first (a GUID for your Teams app; see docs/integrations/teams.md)');
        const file = out(args.flags.out, 'freero-teams.zip');
        fs.writeFileSync(file, teamsAppPackage(originFrom(args.flags.url), teams, versionFrom(args.flags.version)));
        args.print(`Wrote ${file}${teams.bot ? ' (tab, meeting stage and link previews)' : ' (tab and meeting stage; set TEAMS_BOT_ID for link previews)'}`);
      },
    },
    {
      name: 'copilot:package',
      usage: '[--out freero-copilot.zip] [--url https://your-freero.example] [--version 1.0.1]',
      summary: 'Writes the Microsoft 365 Copilot agent package (declarative agent using Freero’s MCP server) for COPILOT_APP_ID and COPILOT_OAUTH_REFERENCE_ID.',
      async run(args) {
        const copilot = ctx.config.copilot;
        if (!copilot) throw new AdminUsageError('Set COPILOT_APP_ID and COPILOT_OAUTH_REFERENCE_ID first (see docs/integrations/teams.md)');
        const file = out(args.flags.out, 'freero-copilot.zip');
        fs.writeFileSync(file, copilotAgentPackage(originFrom(args.flags.url), copilot, versionFrom(args.flags.version)));
        args.print(`Wrote ${file}`);
      },
    },
  ];
}

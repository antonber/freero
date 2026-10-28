// Operator commands of modules/apiauth (reserved file, discovered by apps/server/src/admin.ts).
// Loading it also connects revocation in the CLI process (an operator's two-step reset signs the
// account out everywhere, which must end its API tokens and apps too).
import { AdminUsageError, type AdminCommand } from '../../platform/admin';
import type { ServerContext } from '../../platform/context';
import { findUserByEmail, getUser } from '../auth/index';
import { revokeEverything } from './credentials';
import { connectRevocation } from './wiring';

export default function apiAuthAdmin(ctx: ServerContext): AdminCommand[] {
  const disconnect = connectRevocation();
  ctx.onShutdown(() => void disconnect());
  return [
    {
      name: 'api:revoke-all',
      usage: '<user id | email>',
      summary: 'Revokes every API token and app authorisation of an account (incident response). Their next API call is refused.',
      async run(args) {
        const who = args.positional[0];
        if (!who) throw new AdminUsageError('Give the account’s id or email address');
        const user = who.includes('@') ? await findUserByEmail(who) : await getUser(who);
        if (!user) throw new Error(`no account ${who}`);
        const n = await revokeEverything(user.id, null, 'operator');
        args.print(`revoked   ${n.tokens} token(s) and ${n.apps} app authorisation(s) of ${user.email}`);
      },
    },
  ];
}

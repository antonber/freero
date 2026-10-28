// Operator commands of modules/references (reserved file, discovered by apps/server/src/admin.ts).
import type { AdminCommand } from '../../platform/admin';
import type { ServerContext } from '../../platform/context';
import { registerOutboxConsumer } from '../../platform/outbox';
import { referencesFrom } from './repo';
import { rebuildReferences, referencesConsumer } from './service';

export default function referencesAdmin(_ctx: ServerContext): AdminCommand[] {
  // The rebuild pauses the live consumer (its lock) on whichever instance holds it.
  registerOutboxConsumer(referencesConsumer);
  return [
    {
      name: 'references:rebuild',
      usage: '[<board id>]',
      summary:
        'Re-derives the references index (backlinks) from saved board content: every board, or one. For repair after a restore. Safe while the servers run; their live updates pause meanwhile.',
      async run(args) {
        const boardId = args.positional[0];
        const n = await rebuildReferences(boardId, (done, total) => args.print(`… ${done}/${total} boards`));
        args.print(boardId ? `board ${boardId}: ${(await referencesFrom(boardId)).length} reference(s)` : `rebuilt references of ${n} board(s)`);
      },
    },
  ];
}

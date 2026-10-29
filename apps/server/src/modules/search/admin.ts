// Operator commands of modules/search (reserved file, discovered by apps/server/src/admin.ts).
import type { AdminCommand } from '../../platform/admin';
import type { ServerContext } from '../../platform/context';
import { registerOutboxConsumer } from '../../platform/outbox';
import { entriesOf } from './repo';
import { rebuildSearch, searchConsumer } from './service';

export default function searchAdmin(_ctx: ServerContext): AdminCommand[] {
  // The rebuild pauses the live consumer (its lock) on whichever instance holds it.
  registerOutboxConsumer(searchConsumer);
  return [
    {
      name: 'search:rebuild',
      usage: '[<board id>]',
      summary:
        'Re-derives the search index from saved board content: every board, or one. For repair after a restore, or after an upgrade that changes what is indexed. Safe while the servers run; their live updates pause meanwhile.',
      async run(args) {
        const boardId = args.positional[0];
        const n = await rebuildSearch(boardId, (done, total) => args.print(`… ${done}/${total} boards`));
        args.print(boardId ? `board ${boardId}: ${(await entriesOf(boardId)).length} search entries` : `rebuilt the search index of ${n} board(s)`);
      },
    },
  ];
}

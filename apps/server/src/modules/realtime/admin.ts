// Operator commands of modules/realtime (reserved file, discovered by apps/server/src/admin.ts).
import { richTextToPlain } from '@freero/shared';
import { AdminUsageError, type AdminCommand } from '../../platform/admin';
import { allBoardIds, boardRecords } from '../boards/index';
import { CARD_NOTES_BUG_SINCE, notesToRestoreOn, requestNotesRestore, savedCardNotes, type NotesToRestore } from './cardNotes';

const iso = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}Z`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sinceOf(v: string | true | undefined): number {
  if (v === undefined) return CARD_NOTES_BUG_SINCE;
  const at = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00Z`) : NaN;
  if (Number.isNaN(at)) throw new AdminUsageError('--since takes a date: YYYY-MM-DD');
  return at;
}

export default function realtimeAdmin(): AdminCommand[] {
  return [
    {
      name: 'cards:restore-notes',
      usage: '[--board <board id>] [--since YYYY-MM-DD] [--apply] [--wait <seconds>]',
      summary:
        'Finds task cards whose notes are empty now but were not in a board version since --since (default 2026-10-27, when deselecting a card started wiping them) and lists them (titles only). With --apply the running server writes back the newest such notes on the live board; cards with notes now, and deleted cards, are never touched. Safe to re-run.',
      async run(args) {
        if (args.positional.length) throw new AdminUsageError(`Unexpected ${args.positional.join(' ')}`);
        const board = args.flags.board;
        if (board !== undefined && (typeof board !== 'string' || !board.trim())) throw new AdminUsageError('--board takes a board id');
        const since = sinceOf(args.flags.since);
        const apply = args.flags.apply === true;
        const wait = args.flags.wait === undefined ? 120 : Number(args.flags.wait);
        if (!Number.isFinite(wait) || wait < 0) throw new AdminUsageError('--wait takes a number of seconds');

        const ids = typeof board === 'string' ? [board.trim()] : await allBoardIds();
        const records = new Map((await boardRecords(ids)).map((r) => [r.id, r]));
        if (typeof board === 'string' && !records.has(board.trim())) throw new AdminUsageError(`No board ${board}`);
        args.print(`${apply ? 'Restoring' : 'Dry run: would restore'} card notes wiped since ${iso(since).slice(0, 10)} (${ids.length} board(s) to scan)`);

        const found = new Map<string, NotesToRestore[]>();
        for (const id of ids) {
          const r = records.get(id);
          if (!r || r.kind === 'doc') continue;
          const cards = await notesToRestoreOn(id, since);
          if (!cards.length) continue;
          found.set(id, cards);
          args.print('');
          args.print(`board ${id} "${r.title}"${r.deletedAt ? ' (in the trash)' : ''}`);
          for (const c of cards)
            args.print(`  card ${c.id} "${c.title || '(untitled)'}": notes from the version of ${iso(c.from)}${c.tracked ? ' [linked to a tracker issue]' : ''}`);
        }
        const all = [...found.values()].flat();
        const tracked = all.filter((c) => c.tracked).length;
        args.print('');
        args.print(`${all.length} card(s) on ${found.size} board(s)${tracked ? `; ${tracked} linked to a tracker issue` : ''}.`);
        if (tracked) args.print('Tracker-linked cards: the next sync writes the restored notes back to their issue (repairing issues the wipe cleared).');
        if (!apply) {
          if (all.length) args.print('Nothing changed. Re-run with --apply to restore them.');
          return;
        }
        if (!all.length) return;

        // The running server writes them on the live boards (cardNotes.ts says why not this process).
        for (const id of found.keys()) await requestNotesRestore(id, since);
        args.print(`Asked the server to restore them; waiting up to ${wait}s …`);
        // A card is settled once its saved notes are no longer empty (restored, or rewritten meanwhile) or it is gone.
        const end = Date.now() + wait * 1000;
        const notes = new Map<string, Map<string, string>>();
        const settled = (id: string, c: NotesToRestore) => {
          const now = notes.get(id)?.get(c.id);
          return now === undefined || !!richTextToPlain(now).trim();
        };
        for (;;) {
          for (const id of found.keys()) notes.set(id, await savedCardNotes(id));
          if ([...found].every(([id, cards]) => cards.every((c) => settled(id, c))) || Date.now() >= end) break;
          await sleep(1000);
        }
        const count = { restored: 0, changed: 0, gone: 0, pending: 0 };
        args.print('');
        for (const [id, cards] of found)
          for (const c of cards) {
            const now = notes.get(id)?.get(c.id);
            const what = now === undefined ? 'gone' : now === c.description ? 'restored' : settled(id, c) ? 'changed' : 'pending';
            count[what]++;
            const label = { restored: 'restored', changed: 'left alone (someone wrote notes meanwhile)', gone: 'left alone (deleted meanwhile)', pending: 'not yet' }[what];
            args.print(`${label}: board ${id} card ${c.id} "${c.title || '(untitled)'}"`);
          }
        args.print('');
        args.print(`Restored ${count.restored} of ${all.length} card(s)${count.changed + count.gone ? `; ${count.changed + count.gone} left alone` : ''}.`);
        if (count.pending)
          args.print(
            `${count.pending} still queued: the server restores them when it runs (with the built-in PGlite database it is stopped while this runs: start it). Re-run without --apply to see what is left.`,
          );
      },
    },
  ];
}

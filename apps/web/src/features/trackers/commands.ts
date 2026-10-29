import { ChartGantt, Download, ExternalLink, RefreshCw, TicketPlus, Unlink } from 'lucide-react';
import { defineCommands, type Editor } from '@engine';
import { IMPORT_DIALOG, linkedIssues, openIssue, selectedTimeline, SEND_DIALOG, sendable, trackersAvailable } from './lib/links';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

async function forEachLinked(editor: Editor, act: (linkId: string) => Promise<void>, done: (n: number) => string) {
  const issues = linkedIssues(editor);
  try {
    for (const i of issues) await act(i.id);
    editor.host.notify(done(issues.length), 'success');
  } catch (e) {
    editor.host.notify(e instanceof Error ? e.message : 'The tracker didn’t answer. Try again.', 'error');
  }
}

// Every entry point hides itself unless the server offered a tracker connection on this board for
// this person (who can edit). Viewers and commenters never see them, nor does the palette.
export default defineCommands([
  {
    id: 'trackers.send',
    label: 'Send to tracker…',
    icon: TicketPlus,
    menus: ['context'],
    palette: false,
    when: (editor) => trackersAvailable(editor) && sendable(editor).length > 0,
    run: (editor) =>
      editor.openPanel(SEND_DIALOG, {
        ids: sendable(editor).map((el) => el.id),
      }),
  },
  {
    id: 'trackers.import',
    label: 'Import issues…',
    icon: Download,
    menus: ['board'],
    palette: false,
    when: trackersAvailable,
    run: (editor) => editor.openPanel(IMPORT_DIALOG),
  },
  {
    // Roadmap mode (KAI-160): a tracker query onto the selected timeline, as bars in lanes.
    id: 'trackers.importToTimeline',
    label: 'Import issues onto this timeline…',
    icon: ChartGantt,
    menus: ['context'],
    palette: false,
    when: (editor) => trackersAvailable(editor) && !!selectedTimeline(editor),
    run: (editor) => editor.openPanel(IMPORT_DIALOG, { timelineId: selectedTimeline(editor)?.id }),
  },
  {
    id: 'trackers.open',
    label: 'Open issue',
    icon: ExternalLink,
    group: 'Issue',
    menus: ['context'],
    palette: false,
    minRole: 'viewer',
    when: (editor) => linkedIssues(editor).length === 1,
    run: (editor) => {
      const [hit] = linkedIssues(editor);
      if (hit) openIssue(hit.record.url);
    },
  },
  {
    id: 'trackers.sync',
    label: 'Sync now',
    icon: RefreshCw,
    group: 'Issue',
    menus: ['context'],
    palette: false,
    when: (editor) => trackersAvailable(editor) && linkedIssues(editor).length > 0,
    run: (editor) =>
      void forEachLinked(
        editor,
        (id) => editor.host.trackers!.sync(id),
        (n) => `Syncing ${plural(n, 'issue')}…`,
      ),
  },
  {
    id: 'trackers.unlink',
    label: 'Unlink from issue',
    icon: Unlink,
    group: 'Issue',
    menus: ['context'],
    palette: false,
    when: (editor) => trackersAvailable(editor) && linkedIssues(editor).length > 0,
    run: (editor) =>
      void forEachLinked(
        editor,
        (id) => editor.host.trackers!.unlink(id),
        (n) => `Unlinked ${plural(n, 'issue')}. ${n === 1 ? 'It stays' : 'They stay'} in the tracker.`,
      ),
  },
]);

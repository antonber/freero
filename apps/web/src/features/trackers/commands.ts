import { ChartGantt, Download, ExternalLink, KanbanSquare, RefreshCw, TicketPlus, Unlink } from 'lucide-react';
import { defineCommands, type Editor } from '@engine';
import { IMPORT_DIALOG, linkedIssues, openIssue, selectedKanban, selectedTimeline, SEND_DIALOG, sendable, trackersAvailable } from './lib/links';

import { t } from './messages';

async function forEachLinked(editor: Editor, act: (linkId: string) => Promise<void>, done: (n: number) => string) {
  const issues = linkedIssues(editor);
  try {
    for (const i of issues) await act(i.id);
    editor.host.notify(done(issues.length), 'success');
  } catch (e) {
    editor.host.notify(e instanceof Error ? e.message : t('theTrackerDidnTAnswer'), 'error');
  }
}

// Every entry point hides itself unless the server offered a tracker connection on this board for
// this person (who can edit). Viewers and commenters never see them, nor does the palette.
export default defineCommands([
  {
    id: 'trackers.send',
    label: t('sendToTracker'),
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
    label: t('importIssues'),
    icon: Download,
    menus: ['board'],
    palette: false,
    when: trackersAvailable,
    run: (editor) => editor.openPanel(IMPORT_DIALOG),
  },
  {
    // Roadmap mode (KAI-160): a tracker query onto the selected timeline, as bars in lanes.
    id: 'trackers.importToTimeline',
    label: t('importIssuesOntoThisTimeline'),
    icon: ChartGantt,
    menus: ['context'],
    palette: false,
    when: (editor) => trackersAvailable(editor) && !!selectedTimeline(editor),
    run: (editor) => editor.openPanel(IMPORT_DIALOG, { timelineId: selectedTimeline(editor)?.id }),
  },
  {
    // Into the selected kanban: each issue in the column named after its status, with its priority.
    id: 'trackers.importToKanban',
    label: t('importIssuesIntoThisKanban'),
    icon: KanbanSquare,
    menus: ['context'],
    palette: false,
    when: (editor) => trackersAvailable(editor) && !!selectedKanban(editor),
    run: (editor) => editor.openPanel(IMPORT_DIALOG, { kanbanId: selectedKanban(editor)?.id }),
  },
  {
    id: 'trackers.open',
    label: t('openIssue'),
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
    label: t('syncNow'),
    icon: RefreshCw,
    group: 'Issue',
    menus: ['context'],
    palette: false,
    when: (editor) => trackersAvailable(editor) && linkedIssues(editor).length > 0,
    run: (editor) =>
      void forEachLinked(
        editor,
        (id) => editor.host.trackers!.sync(id),
        (n) => `Syncing ${t('countIssue', { count: n })}…`,
      ),
  },
  {
    id: 'trackers.unlink',
    label: t('unlinkFromIssue'),
    icon: Unlink,
    group: 'Issue',
    menus: ['context'],
    palette: false,
    when: (editor) => trackersAvailable(editor) && linkedIssues(editor).length > 0,
    run: (editor) =>
      void forEachLinked(
        editor,
        (id) => editor.host.trackers!.unlink(id),
        (n) => t('unlinkedValueTheyStayIn', { n, value: t('countIssue', { count: n }) }),
      ),
  },
]);

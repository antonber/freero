import { Flag } from 'lucide-react';
import { defineCommands, type Editor } from '@engine';
import { isReportTarget, REPORT_DIALOG, reportTargetOf } from './lib/target';

// Reporting never writes the board: viewers (and, with KAI-43, visitors on a public link) report
// too. Owners don't report their own board; they can delete what they don't want.
const notOwner = (editor: Editor) => editor.getRole() !== 'owner';

export default defineCommands([
  {
    id: 'report.board',
    icon: Flag,
    label: 'Report board…',
    menus: ['board'],
    minRole: 'viewer',
    when: notOwner,
    run(editor) {
      editor.openPanel(REPORT_DIALOG, { target: { kind: 'board' } });
    },
  },
  {
    id: 'report.item',
    icon: Flag,
    label: 'Report…',
    menus: ['context'],
    minRole: 'viewer',
    when: (editor) => notOwner(editor) && editor.getSelection().length === 1,
    run(editor) {
      const el = editor.getElement(editor.getSelection()[0]);
      if (el) editor.openPanel(REPORT_DIALOG, { target: reportTargetOf(el) });
    },
  },
  {
    // For other features (comments' "Report" on a message): args { target: ReportTarget }.
    id: 'report.open',
    label: 'Report',
    minRole: 'viewer',
    run(editor, args) {
      if (isReportTarget(args?.target)) editor.openPanel(REPORT_DIALOG, { target: args.target });
    },
  },
]);

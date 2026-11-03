import { ClipboardList, FileText, Lightbulb, Shapes, Workflow } from 'lucide-react';
import { defineCommands } from '@engine';
import { AI_DIALOG, aiAvailable, aiOfferedHere, aiOrExplain, clusterable, openAi, selectedElements } from './lib/actions';

// Every entry point hides itself unless the server offered AI on this board for this person (and
// they can edit). In the right-click and board menus they fold into one "AI ▸" submenu. Not in the
// command palette: it lists unavailable commands greyed out, and a board without AI must show none.
// The newer ones (#126, #148, #134) also show where the server offers AI but not to this person on
// this board, and say why when run (`aiOrExplain`).
export default defineCommands([
  {
    id: 'ai.ideas',
    label: 'Generate ideas…',
    icon: Lightbulb,
    group: 'AI',
    menus: ['context', 'board'],
    palette: false,
    when: aiAvailable,
    run: (editor) => openAi(editor, 'ideas'),
  },
  {
    id: 'ai.cluster',
    label: 'Cluster by theme…',
    icon: Shapes,
    group: 'AI',
    menus: ['context'],
    palette: false,
    when: (editor) => aiAvailable(editor) && clusterable(selectedElements(editor)).length >= 2,
    run: (editor) => openAi(editor, 'cluster'),
  },
  {
    id: 'ai.summarize',
    label: 'Summarise…',
    icon: FileText,
    group: 'AI',
    menus: ['context', 'board'],
    palette: false,
    when: aiAvailable,
    run: (editor) => openAi(editor, 'summarize'),
  },
  {
    // #148: a report of a live activity's results (the server reads only results everyone sees).
    id: 'ai.report',
    label: 'Write a report…',
    icon: ClipboardList,
    group: 'AI',
    menus: ['context'],
    palette: false,
    when: (editor) => aiOfferedHere(editor) && selectedElements(editor).length === 1 && selectedElements(editor)[0].type === 'activity',
    run: (editor) => {
      if (aiOrExplain(editor)) editor.openPanel(AI_DIALOG, { task: 'report', ids: editor.getSelection() });
    },
  },
  {
    // #148: "Summarise" after a meeting-notes import: a summary note inside that meeting's frame.
    // Run by other features with { frameId } (no menu of its own).
    id: 'ai.summarizeFrame',
    label: 'Summarise with AI',
    palette: false,
    when: aiOfferedHere,
    run: (editor, args) => {
      const frameId = typeof args?.frameId === 'string' ? args.frameId : null;
      if (!frameId || editor.getElement(frameId)?.type !== 'frame' || !aiOrExplain(editor)) return;
      editor.openPanel(AI_DIALOG, { task: 'summarize', ids: [frameId], into: frameId });
    },
  },
  {
    id: 'ai.diagram',
    label: 'Diagram from text…',
    icon: Workflow,
    group: 'AI',
    menus: ['context', 'board'],
    palette: false,
    when: aiAvailable,
    run: (editor) => openAi(editor, 'diagram'),
  },
]);

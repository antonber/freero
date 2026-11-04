import { ClipboardList, FileText, History, Lightbulb, ListChecks, Shapes, Sparkles, Workflow } from 'lucide-react';
import { defineCommands } from '@engine';
import { AI_DIALOG, aiAvailable, aiOfferedHere, aiOrExplain, ASSISTANT_DOCK, CATCH_UP_DIALOG, clusterable, openAi, selectedElements } from './lib/actions';
import { WORKFLOWS_DIALOG, workflowsHere } from './lib/Workflows';

import { t } from './messages';
// Every entry point hides itself unless the server offered AI on this board for this person (and
// they can edit). In the right-click and board menus they fold into one "AI ▸" submenu. Not in the
// command palette: it lists unavailable commands greyed out, and a board without AI must show none.
// The newer ones (#126, #148, #134) also show where the server offers AI but not to this person on
// this board, and say why when run (`aiOrExplain`).
export default defineCommands([
  {
    // #1: the board assistant beside the board (also for viewers the workspace lets use AI).
    id: 'ai.assistant',
    label: t('askTheBoardAssistant'),
    icon: Sparkles,
    group: 'AI',
    menus: ['board'],
    palette: false,
    minRole: 'viewer',
    when: (editor) => !!editor.host.assistant,
    run: (editor) => editor.openDock(editor.getDock() === ASSISTANT_DOCK ? null : ASSISTANT_DOCK),
  },
  {
    // #1: saved workflows — named instructions for the assistant, run again on this board. Their
    // results are pending suggestions, so only people who can edit (and accept them) run them.
    id: 'ai.workflows',
    label: t('aiWorkflowsMenu'),
    icon: ListChecks,
    group: 'AI',
    menus: ['board'],
    palette: false,
    when: workflowsHere,
    run: (editor) => editor.openPanel(WORKFLOWS_DIALOG),
  },
  {
    id: 'ai.ideas',
    label: t('generateIdeas'),
    icon: Lightbulb,
    group: 'AI',
    menus: ['context', 'board'],
    palette: false,
    when: aiAvailable,
    run: (editor) => openAi(editor, 'ideas'),
  },
  {
    id: 'ai.cluster',
    label: t('clusterByTheme'),
    icon: Shapes,
    group: 'AI',
    menus: ['context'],
    palette: false,
    when: (editor) => aiAvailable(editor) && clusterable(selectedElements(editor)).length >= 2,
    run: (editor) => openAi(editor, 'cluster'),
  },
  {
    id: 'ai.summarize',
    label: t('summarise'),
    icon: FileText,
    group: 'AI',
    menus: ['context', 'board'],
    palette: false,
    when: aiAvailable,
    run: (editor) => openAi(editor, 'summarize'),
  },
  {
    // #126: a written catch-up of what others changed (the activity feature's catch-up bar runs it
    // with { since: 'visit' }).
    id: 'ai.catchUp',
    label: t('catchMeUp'),
    icon: History,
    group: 'AI',
    menus: ['board'],
    palette: false,
    when: aiOfferedHere,
    run: (editor, args) => {
      if (aiOrExplain(editor)) editor.openPanel(CATCH_UP_DIALOG, { since: args?.since ?? 'visit' });
    },
  },
  {
    // #148: a report of a live activity's results (the server reads only results everyone sees).
    id: 'ai.report',
    label: t('writeAReport'),
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
    // #148: "Summarise" after a meeting-notes import: the summary written into that meeting's
    // "Summary" note ({ fill }), else a new note inside its frame. Run by other features with
    // { frameId, fill? } (no menu of its own).
    id: 'ai.summarizeFrame',
    label: t('summariseWithAi'),
    palette: false,
    when: aiOfferedHere,
    run: (editor, args) => {
      const frameId = typeof args?.frameId === 'string' ? args.frameId : null;
      if (!frameId || editor.getElement(frameId)?.type !== 'frame' || !aiOrExplain(editor)) return;
      const fill = typeof args?.fill === 'string' ? args.fill : undefined;
      editor.openPanel(AI_DIALOG, { task: 'summarize', ids: [frameId], into: frameId, ...(fill ? { fill } : {}) });
    },
  },
  {
    id: 'ai.diagram',
    label: t('diagramFromText'),
    icon: Workflow,
    group: 'AI',
    menus: ['context', 'board'],
    palette: false,
    when: aiAvailable,
    run: (editor) => openAi(editor, 'diagram'),
  },
]);

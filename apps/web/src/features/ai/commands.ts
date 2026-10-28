import { FileText, Lightbulb, Shapes, Workflow } from 'lucide-react';
import { defineCommands } from '@engine';
import { aiAvailable, clusterable, openAi, selectedElements } from './lib/actions';

// Every entry point hides itself unless the server offered AI on this board for this person (and
// they can edit). In the right-click and board menus they fold into one "AI ▸" submenu. Not in the
// command palette: it lists unavailable commands greyed out, and a board without AI must show none.
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

import { Lightbulb } from 'lucide-react';
import { defineCommands } from '@engine';
import { PANEL_ID, accept, reject } from './lib/model';

const idsOf = (args: Record<string, unknown> | undefined): string[] =>
  Array.isArray(args?.ids) ? (args.ids as unknown[]).filter((i): i is string => typeof i === 'string') : [];

export default defineCommands([
  {
    id: 'suggestions.togglePanel',
    label: 'Suggestions',
    icon: Lightbulb,
    menus: ['board'],
    run: (editor) => editor.openDock(editor.getDock() === PANEL_ID ? null : PANEL_ID),
  },
  // For other features (in-app AI, KAI-102): accept / reject given suggestion ids, with the same
  // safety as the buttons (stale ones ask first).
  { id: 'suggestions.accept', label: 'Accept suggestions', run: (editor, args) => accept(editor, idsOf(args)) },
  { id: 'suggestions.reject', label: 'Reject suggestions', run: (editor, args) => reject(editor, idsOf(args)) },
]);

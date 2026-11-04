import { Lightbulb } from 'lucide-react';
import { defineCommands } from '@engine';
import { PANEL_ID, accept, reject } from './lib/model';

import { t } from './messages';
const idsOf = (args: Record<string, unknown> | undefined): string[] =>
  Array.isArray(args?.ids) ? (args.ids as unknown[]).filter((i): i is string => typeof i === 'string') : [];

export default defineCommands([
  {
    id: 'suggestions.togglePanel',
    label: t('suggestions'),
    icon: Lightbulb,
    menus: ['board'],
    run: (editor) => editor.openDock(editor.getDock() === PANEL_ID ? null : PANEL_ID),
  },
  // For other features (in-app AI, KAI-102): show the review list; accept / reject given
  // suggestion ids, with the same safety as the buttons (stale ones ask first).
  { id: 'suggestions.open', label: t('reviewSuggestions'), run: (editor) => editor.openDock(PANEL_ID) },
  { id: 'suggestions.accept', label: t('acceptSuggestions'), run: (editor, args) => accept(editor, idsOf(args)) },
  { id: 'suggestions.reject', label: t('rejectSuggestions'), run: (editor, args) => reject(editor, idsOf(args)) },
]);

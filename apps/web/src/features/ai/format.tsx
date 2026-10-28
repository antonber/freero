import { Sparkles } from 'lucide-react';
import { defineFormat } from '@engine';
import { IconButton } from '@ui';
import { aiAvailable, openAi } from './lib/actions';

/** One "AI" button in the contextual toolbar: opens the AI dialog on the selection. */
export default defineFormat({
  id: 'ai.format',
  order: 95,
  appliesTo: (selection) => selection.length > 0,
  Component: ({ editor }) => {
    if (!aiAvailable(editor)) return null;
    return <IconButton icon={Sparkles} label="AI" size={32} onClick={() => openAi(editor)} />;
  },
});

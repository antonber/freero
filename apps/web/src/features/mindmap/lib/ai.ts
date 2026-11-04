import type { Editor } from '@engine';
import { EXPAND_DIALOG } from './constants';

import { t } from '../messages';
/**
 * Expand with AI (#134): shown where the server offers AI (Host.ai), or where it exists but not
 * for this person here (Host.aiUnavailable) — then running it says why. Without AI on the server,
 * it doesn't show at all.
 */
export function expandWithAi(editor: Editor, id: string): void {
  if (editor.host.ai && editor.can('editor')) editor.openPanel(EXPAND_DIALOG, { id });
  else editor.host.notify(editor.host.aiUnavailable ?? t('expandingWithAiAddsTo'), 'info');
}

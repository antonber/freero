import { ClipboardPaste, Paintbrush } from 'lucide-react';
import { defineCommands, type Editor } from '@engine';
import { applyStyle, pickUp, storedStyle } from './lib/style';

const idle = (editor: Editor) => !editor.getEditingId();

export default defineCommands([
  {
    id: 'format-painter.copyStyle',
    label: 'Copy style',
    icon: Paintbrush,
    shortcut: 'mod+alt+c',
    menus: ['context'],
    when: (editor) => idle(editor) && editor.getSelection().length === 1,
    run(editor) {
      if (pickUp(editor)) editor.host.notify('Style copied. Paste it with Alt+Mod+V.', 'success');
    },
  },
  {
    id: 'format-painter.pasteStyle',
    label: 'Paste style',
    icon: ClipboardPaste,
    shortcut: 'mod+alt+v',
    menus: ['context'],
    when: (editor) => idle(editor) && editor.getSelection().length > 0 && !!storedStyle(editor),
    run(editor) {
      // Its own undo step, never merged with an edit made just before.
      editor.beginGesture();
      try {
        applyStyle(editor, editor.getSelection());
      } finally {
        editor.endGesture();
      }
    },
  },
]);

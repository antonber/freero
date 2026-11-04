import { Code2, TextCursorInput, Workflow } from 'lucide-react';
import { LayoutError } from '@freero/shared';
import { defineCommands, type Point } from '@engine';
import { DIALOG_ID, containerOf, insertLaid, layoutText, selectedDiagram, updateDiagram } from './lib/insert';
import { KINDS, type TextKind } from './lib/parse';

import { t } from './messages';
const isKind = (v: unknown): v is TextKind => KINDS.some((k) => k.value === v);
const isPoint = (v: unknown): v is Point => !!v && typeof (v as Point).x === 'number' && typeof (v as Point).y === 'number';

export default defineCommands([
  {
    id: 'from-text.open',
    label: t('insertFromText'),
    icon: TextCursorInput,
    menus: ['board'],
    run(editor) {
      editor.openPanel(DIALOG_ID, { at: editor.getViewportCenter() });
    },
  },
  {
    id: 'from-text.editSource',
    label: t('editDiagramSource'),
    icon: Code2,
    menus: ['context'],
    when: (editor) => !!selectedDiagram(editor),
    disabledReason: t('selectADiagramInsertedFrom'),
    run(editor) {
      const d = selectedDiagram(editor);
      if (d) editor.openPanel(DIALOG_ID, { diagramId: d.diagramId });
    },
  },
  {
    // The diagram laid out again from its source, every item back in place (styles kept). A diagram
    // container lays itself out ("Lay out again", features/diagram).
    id: 'from-text.relayout',
    label: t('reLayOutDiagram'),
    icon: Workflow,
    menus: ['context'],
    when: (editor) => {
      const d = selectedDiagram(editor);
      return !!d && !containerOf(editor, d.record);
    },
    disabledReason: t('selectADiagramInsertedFrom2'),
    run(editor) {
      const d = selectedDiagram(editor);
      if (!d) return;
      try {
        updateDiagram(editor, d.diagramId, d.record.source, { keepMoved: false });
      } catch (e) {
        editor.host.notify(e instanceof Error ? e.message : t('theDiagramCouldNotBe'), 'error');
      }
    },
  },
  {
    // How other features hand text over (a pasted Mermaid diagram): { kind, text, at? }.
    // Invalid text is reported with an "Edit" action that opens it in the dialog; nothing lands.
    id: 'from-text.insert',
    label: t('insertTextAsADiagram'),
    run(editor, args) {
      const kind = args?.kind;
      const text = args?.text;
      if (!isKind(kind) || typeof text !== 'string') return;
      const at = isPoint(args?.at) ? args.at : undefined;
      try {
        insertLaid(editor, kind, text, layoutText(kind, text), at);
      } catch (e) {
        if (!(e instanceof LayoutError)) throw e;
        editor.host.notify(t('couldnTReadTheDiagram', { message: e.message }), 'error', {
          action: { label: t('edit'), run: () => editor.openPanel(DIALOG_ID, { kind, text, at }) },
        });
      }
    },
  },
]);

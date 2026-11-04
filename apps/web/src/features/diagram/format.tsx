import { Focus, Layers, Wand2 } from 'lucide-react';
import { DIAGRAM_LAYOUTS, DIAGRAM_LAYOUT_NAMES, type DiagramElement, type DiagramLayout } from '@freero/shared';
import { defineFormat } from '@engine';
import { IconButton, Select } from '@ui';
import { focusDiagram, relayout, setLayout } from './lib/actions';
import { LAYERS_PANEL } from './lib/ids';

import { t } from './messages';
const DESCRIPTIONS: Record<DiagramLayout, string> = {
  down: t('stepsFlowDownwards'),
  right: t('stepsFlowToTheRight'),
  up: t('stepsFlowUpwards'),
  left: t('stepsFlowToTheLeft'),
  tree: t('branchesToTheRight'),
  orgchart: t('aTopDownTree'),
  manual: t('nothingMovesByItself'),
};

/** One selected diagram: its layout, lay out again, layers, focus. */
export default defineFormat({
  id: 'diagram.format',
  order: 50,
  appliesTo: (selection) => selection.length === 1 && selection[0].type === 'diagram',
  Component: ({ editor, selection }) => {
    const d = selection[0] as DiagramElement;
    const editable = editor.can('editor') && !d.locked;
    return (
      <div className="fr-diagram-format">
        {editable && (
          <Select<DiagramLayout>
            size="sm"
            variant="ghost"
            aria-label={t('layout')}
            value={d.layout}
            options={DIAGRAM_LAYOUTS.map((l) => ({ value: l, label: DIAGRAM_LAYOUT_NAMES[l], description: DESCRIPTIONS[l] }))}
            onChange={(l) => setLayout(editor, d.id, l)}
          />
        )}
        {editable && d.layout !== 'manual' && <IconButton icon={Wand2} label={t('layOutAgainStepsMoved')} size={32} onClick={() => relayout(editor, d.id)} />}
        <IconButton icon={Layers} label={t('layers')} size={32} onClick={() => editor.openDock(LAYERS_PANEL)} />
        <IconButton icon={Focus} label={t('focusOnThisDiagram')} size={32} onClick={() => focusDiagram(editor, d.id)} />
      </div>
    );
  },
});

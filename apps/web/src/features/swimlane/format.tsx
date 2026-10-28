import { Columns3, Plus, Rows3 } from 'lucide-react';
import type { SwimlaneElement } from '@freero/shared';
import { defineFormat } from '@engine';
import { SegmentedControl } from '@ui';
import { addBand, setVertical } from './lib/actions';

/** One selected pool: add a lane or a phase, lanes as rows or columns. */
export default defineFormat({
  id: 'swimlane.format',
  order: 50,
  appliesTo: (selection) => selection.length === 1 && selection[0].type === 'swimlane',
  Component: ({ editor, selection }) => {
    const p = selection[0] as SwimlaneElement;
    if (p.locked) return null;
    return (
      <div className="fr-swim-format">
        <button type="button" className="fr-swim-format__btn" onClick={() => addBand(editor, p.id, 'lanes')}>
          <Plus size={16} aria-hidden />
          Lane
        </button>
        <button type="button" className="fr-swim-format__btn" onClick={() => addBand(editor, p.id, 'phases')}>
          <Plus size={16} aria-hidden />
          Phase
        </button>
        <SegmentedControl<'rows' | 'columns'>
          size="sm"
          aria-label="Lane direction"
          value={p.vertical ? 'columns' : 'rows'}
          options={[
            { value: 'rows', icon: Rows3, title: 'Lanes as rows' },
            { value: 'columns', icon: Columns3, title: 'Lanes as columns' },
          ]}
          onChange={(v) => setVertical(editor, p.id, v === 'columns')}
        />
      </div>
    );
  },
});

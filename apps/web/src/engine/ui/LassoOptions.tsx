// The lasso tool's flyout (#111): what a loop selects, kept per browser like other tool options.
import { SegmentedControl } from '@ui';
import type { Editor, LassoMode } from '../api';
import { useToolOptions } from '../hooks';
import { LASSO_TOOL, type LassoOptions as Options } from '../interaction/selectTool';

const MODES = [
  { value: 'inside' as const, label: 'Inside', title: 'Select items inside the loop' },
  { value: 'touch' as const, label: 'Touching', title: 'Select every item the loop touches' },
];

export function LassoOptions({ editor }: { editor: Editor }) {
  const { mode = 'inside' } = useToolOptions<Options>(LASSO_TOOL);
  return (
    <div className="fr-lasso-options">
      <div className="fr-lasso-options__label">Select items</div>
      <SegmentedControl<LassoMode>
        size="sm"
        value={mode}
        onChange={(next) => editor.setToolOptions(LASSO_TOOL, { mode: next })}
        options={MODES}
        aria-label="What the lasso selects"
      />
    </div>
  );
}

// The lasso tool's flyout (#111): what a loop selects, kept per browser like other tool options.
import { SegmentedControl } from '@ui';
import type { Editor, LassoMode } from '../api';
import { useToolOptions } from '../hooks';
import { LASSO_TOOL, type LassoOptions as Options } from '../interaction/selectTool';

import { t } from '../messages';
const MODES = [
  { value: 'inside' as const, label: t('inside'), title: t('selectItemsInsideTheLoop') },
  { value: 'touch' as const, label: t('touching'), title: t('selectEveryItemTheLoop') },
];

export function LassoOptions({ editor }: { editor: Editor }) {
  const { mode = 'inside' } = useToolOptions<Options>(LASSO_TOOL);
  return (
    <div className="fr-lasso-options">
      <div className="fr-lasso-options__label">{t('selectItems')}</div>
      <SegmentedControl<LassoMode>
        size="sm"
        value={mode}
        onChange={(next) => editor.setToolOptions(LASSO_TOOL, { mode: next })}
        options={MODES}
        aria-label={t('whatTheLassoSelects')}
      />
    </div>
  );
}

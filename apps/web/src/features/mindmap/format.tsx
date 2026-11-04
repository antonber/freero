import { useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowLeftRight, ArrowRight, ChevronsDownUp, ChevronsUpDown, ListTree, Plus, Sparkles } from 'lucide-react';
import type { MindmapElement } from '@freero/shared';
import { defineFormat, type Editor } from '@engine';
import { ColorSwatches, IconButton, Popover, SegmentedControl, Tooltip } from '@ui';
import { BRANCH_COLORS, COLOR_NAMES, ROOT_COLORS } from './lib/constants';
import { addChild, currentIndex, relayout, rootIdsOf, setBranchColor, setDirection, toggleCollapse } from './lib/actions';
import { expandWithAi } from './lib/ai';
import type { Direction } from './lib/tree';

import { t } from './messages';
function ColorControl({ editor, nodes }: { editor: Editor; nodes: MindmapElement[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const onlyRoots = nodes.every((n) => !n.parentId);
  const colors = onlyRoots ? ROOT_COLORS : BRANCH_COLORS;
  const current = nodes[0].color;
  const mixed = nodes.some((n) => n.color !== current);
  return (
    <>
      <Tooltip content={onlyRoots ? t('topicColor') : t('branchColor')} side="bottom">
        <button
          ref={ref}
          type="button"
          className="fr-mm-swatch-btn"
          aria-label={onlyRoots ? t('topicColor') : t('branchColor')}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span style={{ background: current }} />
        </button>
      </Tooltip>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label={t('branchColor')}>
        <ColorSwatches
          colors={colors}
          names={COLOR_NAMES}
          value={mixed ? null : current}
          columns={4}
          size={26}
          allowCustom
          onChange={(c) => setBranchColor(editor, nodes.map((n) => n.id), c)}
          aria-label={onlyRoots ? t('topicColor') : t('branchColor')}
        />
      </Popover>
    </>
  );
}

export default defineFormat({
  id: 'mindmap.format',
  order: 15,
  appliesTo: (selection) => selection.length > 0 && selection.every((el) => el.type === 'mindmap'),
  Component: ({ editor, selection }) => {
    const nodes = selection as MindmapElement[];
    const rootIds = rootIdsOf(editor, nodes.map((n) => n.id));
    const roots = rootIds.map((id) => editor.getElement<MindmapElement>(id)).filter((r): r is MindmapElement => !!r);
    const direction = roots[0]?.direction ?? 'right';
    const single = nodes.length === 1 ? nodes[0] : null;
    const hasKids = !!single && !!currentIndex(editor).kids.get(single.id)?.length;
    return (
      <>
        <ColorControl editor={editor} nodes={nodes} />
        {roots.length > 0 && (
          <SegmentedControl<Direction>
            size="sm"
            value={roots.every((r) => (r.direction ?? 'right') === direction) ? direction : ('' as Direction)}
            onChange={(d) => setDirection(editor, rootIds, d)}
            options={[
              { value: 'left', icon: ArrowLeft, title: t('growToTheLeft') },
              { value: 'both', icon: ArrowLeftRight, title: t('growOnBothSides') },
              { value: 'right', icon: ArrowRight, title: t('growToTheRight') },
              { value: 'down', icon: ArrowDown, title: t('growDownwards') },
            ]}
            aria-label={t('mapDirection')}
          />
        )}
        {single && <IconButton icon={Plus} label={t('addChildIdea')} shortcut="Tab" size={32} onClick={() => addChild(editor, single.id)} />}
        {/* #134: greyed out with the reason where AI exists on the server but not for this person here. */}
        {single && (editor.host.ai || editor.host.aiUnavailable) && (
          <IconButton
            icon={Sparkles}
            label={editor.host.ai ? t('expandWithAi2') : t('expandWithAiAiunavailable', { aiUnavailable: editor.host.aiUnavailable })}
            size={32}
            // Not `disabled`: the tooltip (and a click) must still say why.
            aria-disabled={!editor.host.ai || undefined}
            className={editor.host.ai ? undefined : 'fr-mm-ai-off'}
            onClick={() => expandWithAi(editor, single.id)}
          />
        )}
        {single && hasKids && (
          <IconButton
            icon={single.collapsed ? ChevronsUpDown : ChevronsDownUp}
            label={single.collapsed ? t('expandBranch') : t('collapseBranch')}
            size={32}
            onClick={() => toggleCollapse(editor, single.id)}
          />
        )}
        <IconButton icon={ListTree} label={t('tidyUpLayout')} size={32} onClick={() => relayout(editor, rootIds)} />
      </>
    );
  },
});

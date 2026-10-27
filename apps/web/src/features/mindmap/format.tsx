import { useRef, useState } from 'react';
import { ArrowLeft, ArrowLeftRight, ArrowRight, ChevronsDownUp, ChevronsUpDown, ListTree, Plus } from 'lucide-react';
import type { MindmapElement } from '@freero/shared';
import { defineFormat, type Editor } from '@engine';
import { ColorSwatches, IconButton, Popover, SegmentedControl } from '@ui';
import { BRANCH_COLORS, COLOR_NAMES, ROOT_COLORS } from './lib/constants';
import { addChild, currentIndex, relayout, rootIdsOf, setBranchColor, setDirection, toggleCollapse } from './lib/actions';
import type { Direction } from './lib/tree';

function ColorControl({ editor, nodes }: { editor: Editor; nodes: MindmapElement[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const onlyRoots = nodes.every((n) => !n.parentId);
  const colors = onlyRoots ? ROOT_COLORS : BRANCH_COLORS;
  const current = nodes[0].color;
  const mixed = nodes.some((n) => n.color !== current);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="fr-mm-swatch-btn"
        aria-label={onlyRoots ? 'Topic color' : 'Branch color'}
        aria-expanded={open}
        title={onlyRoots ? 'Topic color' : 'Branch color'}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ background: current }} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label="Branch color">
        <ColorSwatches
          colors={colors}
          names={COLOR_NAMES}
          value={mixed ? null : current}
          columns={4}
          size={26}
          allowCustom
          onChange={(c) => setBranchColor(editor, nodes.map((n) => n.id), c)}
          aria-label={onlyRoots ? 'Topic color' : 'Branch color'}
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
              { value: 'left', icon: ArrowLeft, title: 'Grow to the left' },
              { value: 'both', icon: ArrowLeftRight, title: 'Grow on both sides' },
              { value: 'right', icon: ArrowRight, title: 'Grow to the right' },
            ]}
            aria-label="Map direction"
          />
        )}
        {single && <IconButton icon={Plus} label="Add child idea" shortcut="Tab" size={32} onClick={() => addChild(editor, single.id)} />}
        {single && hasKids && (
          <IconButton
            icon={single.collapsed ? ChevronsUpDown : ChevronsDownUp}
            label={single.collapsed ? 'Expand branch' : 'Collapse branch'}
            size={32}
            onClick={() => toggleCollapse(editor, single.id)}
          />
        )}
        <IconButton icon={ListTree} label="Tidy up layout" size={32} onClick={() => relayout(editor, rootIds)} />
      </>
    );
  },
});

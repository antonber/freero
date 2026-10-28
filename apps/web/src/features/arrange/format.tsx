import { useRef, useState } from 'react';
import { AlignStartVertical } from 'lucide-react';
import { defineFormat } from '@engine';
import { IconButton, Popover, formatShortcut } from '@ui';
import { ARRANGE_COMMANDS, CLUSTER_COMMANDS } from './commands';
import { unitsOf } from './lib/arrange';
import './arrange.css';

/** Multi-selections: one "Align" button opening a palette of align / distribute / tidy actions. */
export default defineFormat({
  id: 'arrange.format',
  order: 90,
  appliesTo: (selection) => selection.filter((el) => el.type !== 'connector').length >= 2,
  Component: ({ editor, selection }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLButtonElement>(null);
    // Grouped items move as one: a single group isn't something to align.
    if (unitsOf(selection, (el) => ({ x: el.x, y: el.y, w: el.w, h: el.h })).length < 2) return null;
    return (
      <>
        <IconButton ref={ref} icon={AlignStartVertical} label="Align and distribute" size={32} active={open} onClick={() => setOpen((o) => !o)} />
        <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" align="center" className="fr-arrange">
          <div className="fr-arrange__grid" role="group" aria-label="Align and distribute">
            {ARRANGE_COMMANDS.map((c) => {
              const enabled = !c.when || c.when(editor);
              return (
                <IconButton
                  key={c.id}
                  icon={c.icon!}
                  label={c.label}
                  shortcut={c.shortcut ? formatShortcut(c.shortcut) : undefined}
                  size={32}
                  disabled={!enabled}
                  onClick={() => editor.runCommand(c.id)}
                />
              );
            })}
          </div>
          {CLUSTER_COMMANDS.some((c) => c.when(editor)) && (
            <div className="fr-arrange__cluster" role="group" aria-label="Cluster stickies">
              {CLUSTER_COMMANDS.map((c) => (
                <button key={c.id} type="button" className="fr-arrange__cluster-btn" onClick={() => editor.runCommand(c.id)}>
                  <c.icon size={16} aria-hidden />
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </Popover>
      </>
    );
  },
});

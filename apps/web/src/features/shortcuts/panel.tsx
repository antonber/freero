import { useMemo, useRef, useState } from 'react';
import { CircleHelp, Keyboard, MessageSquareWarning, Search } from 'lucide-react';
import { definePanel, useRole, type Editor, type PanelProps } from '@engine';
import { IconButton, Input, Kbd, Menu, Modal } from '@ui';
import { SHEET_PANEL, buildSheet } from './lib/sheet';
import { PALETTE_PANEL } from './lib/palette';
import { Palette } from './lib/PaletteDialog';
import './shortcuts.css';

function Sheet({ editor }: PanelProps) {
  const [query, setQuery] = useState('');
  // Re-read on role changes: a viewer promoted to editor sees the editing keys appear.
  const role = useRole();
  const entries = useMemo(() => editor.getShortcuts(), [editor, role]);
  const sections = buildSheet(entries, query);
  const close = () => editor.closePanel(SHEET_PANEL);
  return (
    <Modal open onClose={close} title="Keyboard shortcuts" width={760} className="fr-shortcuts">
      <Input
        data-autofocus=""
        icon={Search}
        placeholder="Search shortcuts"
        aria-label="Search shortcuts"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {sections.length === 0 ? (
        <p className="fr-shortcuts__empty">No shortcuts match “{query.trim()}”.</p>
      ) : (
        <div className="fr-shortcuts__grid">
          {sections.map((s) => (
            <section key={s.title} className="fr-shortcuts__section" aria-label={s.title}>
              <h3 className="fr-shortcuts__title">{s.title}</h3>
              <dl className="fr-shortcuts__list">
                {s.rows.map((r) => (
                  <div key={r.id} className="fr-shortcuts__row">
                    <dt>{r.label}</dt>
                    <dd>
                      {r.keys.map((k, i) => (
                        <span key={k} className="fr-shortcuts__alt">
                          {i > 0 && r.alternatives && <span className="fr-shortcuts__or">or</span>}
                          <Kbd>{k}</Kbd>
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}

/**
 * The board's help button: the shortcut sheet, and — for people with an account — "Report a
 * problem…" (features/problem-report's command; the dialog is the app's). Without that, one click
 * opens the sheet as before.
 */
function HelpButton({ editor }: { editor: Editor }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const canReport = !!editor.host.reportProblem;
  return (
    <>
      <IconButton
        ref={ref}
        icon={CircleHelp}
        label={canReport ? 'Help' : 'Keyboard shortcuts'}
        shortcut={canReport ? undefined : '?'}
        size={32}
        tooltipSide="top"
        aria-haspopup={canReport ? 'menu' : undefined}
        onClick={() => (canReport ? setOpen((o) => !o) : editor.openPanel(SHEET_PANEL))}
      />
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchor={ref.current}
        side="top"
        align="end"
        aria-label="Help"
        items={[
          { id: 'shortcuts', label: 'Keyboard shortcuts', icon: Keyboard, shortcut: '?', onSelect: () => editor.openPanel(SHEET_PANEL) },
          { id: 'problem', label: 'Report a problem…', icon: MessageSquareWarning, shortcut: 'mod+alt+p', onSelect: () => editor.runCommand('problem-report.open') },
        ]}
      />
    </>
  );
}

export default [
  definePanel({ id: SHEET_PANEL, slot: 'dialog', order: 50, minRole: 'viewer', Component: Sheet }),
  definePanel({ id: PALETTE_PANEL, slot: 'dialog', order: 50, minRole: 'viewer', Component: Palette }),
  definePanel({ id: 'shortcuts.help', slot: 'bottom-right', order: 90, minRole: 'viewer', Component: HelpButton }),
];

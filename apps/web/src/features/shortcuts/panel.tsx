import { useMemo, useState } from 'react';
import { CircleHelp, Search } from 'lucide-react';
import { definePanel, useRole, type Editor, type PanelProps } from '@engine';
import { IconButton, Input, Kbd, Modal } from '@ui';
import { SHEET_PANEL, buildSheet } from './lib/sheet';
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
                          {i > 0 && r.keys.length === 2 && <span className="fr-shortcuts__or">or</span>}
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

function HelpButton({ editor }: { editor: Editor }) {
  return (
    <IconButton
      icon={CircleHelp}
      label="Keyboard shortcuts"
      shortcut="?"
      size={32}
      tooltipSide="top"
      onClick={() => editor.openPanel(SHEET_PANEL)}
    />
  );
}

export default [
  definePanel({ id: SHEET_PANEL, slot: 'dialog', order: 50, minRole: 'viewer', Component: Sheet }),
  definePanel({ id: 'shortcuts.help', slot: 'bottom-right', order: 90, minRole: 'viewer', Component: HelpButton }),
];

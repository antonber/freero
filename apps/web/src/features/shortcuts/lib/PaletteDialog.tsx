// Command palette: type a few letters, run any board action from the keyboard. ARIA combobox
// (the search field) driving a listbox; unavailable actions stay listed, greyed out, with why.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Clock, Search } from 'lucide-react';
import { useRole, type PanelProps } from '@engine';
import { Input, Kbd, Modal } from '@ui';
import { PALETTE_PANEL, loadRecent, rankActions, rememberRecent, type PaletteRow } from './palette';

const PAGE = 8;

export function Palette({ editor }: PanelProps) {
  const role = useRole();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // Read once per opening (and on role changes): the board doesn't change under a modal.
  const entries = useMemo(() => editor.listActions(), [editor, role]);
  const recent = useMemo(() => loadRecent(editor.user.id), [editor]);
  const rows = useMemo(() => rankActions(entries, query, recent), [entries, query, recent]);
  const listId = useId();
  const optionId = (i: number) => `${listId}-o${i}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const close = () => editor.closePanel(PALETTE_PANEL);

  // Focus while mounting, so no keystroke typed right after the shortcut reaches the board.
  useLayoutEffect(() => inputRef.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' });
  });

  const run = (row: PaletteRow | undefined) => {
    if (!row || row.entry.disabledReason) return;
    const { id, kind } = row.entry;
    rememberRecent(editor.user.id, id);
    close();
    // After the palette is gone (and focus is back on the board), like a click on the board's
    // own buttons: dialogs a command opens and text it starts editing keep their focus.
    setTimeout(() => (kind === 'tool' ? editor.setTool(id) : editor.runCommand(id)), 0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const last = rows.length - 1;
    const move = (to: number) => {
      e.preventDefault();
      setActive(Math.max(0, Math.min(last, to)));
    };
    if (e.key === 'ArrowDown') move(active >= last ? 0 : active + 1);
    else if (e.key === 'ArrowUp') move(active <= 0 ? last : active - 1);
    else if (e.key === 'PageDown') move(active + PAGE);
    else if (e.key === 'PageUp') move(active - PAGE);
    else if (e.key === 'Home' && e.ctrlKey) move(0);
    else if (e.key === 'End' && e.ctrlKey) move(last);
    else if (e.key === 'Enter') {
      e.preventDefault();
      run(rows[active]);
    }
  };

  const current = rows[active];
  const status = !rows.length
    ? 'No actions match'
    : `${rows.length} ${rows.length === 1 ? 'action' : 'actions'}${current?.entry.disabledReason ? `. ${current.entry.label} is unavailable: ${current.entry.disabledReason}` : ''}`;

  return (
    <Modal open onClose={close} title="Command palette" width={600} className="fr-shortcuts-palette">
      <Input
        ref={inputRef}
        icon={Search}
        placeholder="Search actions, tools and settings"
        aria-label="Search actions"
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={current ? optionId(active) : undefined}
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <div className="fr-sr-only" role="status" aria-live="polite">
        {status}
      </div>
      {rows.length === 0 ? (
        <p className="fr-shortcuts-palette__empty">Nothing matches “{query.trim()}”.</p>
      ) : (
        <ul id={listId} role="listbox" aria-label="Actions" className="fr-shortcuts-palette__list">
          {rows.map((row, i) => {
            const { entry } = row;
            const Icon = entry.icon;
            const disabled = !!entry.disabledReason;
            return (
              <li
                key={`${entry.kind}:${entry.id}`}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                aria-disabled={disabled || undefined}
                className={`fr-shortcuts-palette__item${i === active ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`}
                onMouseMove={() => i !== active && setActive(i)}
                // Keep focus in the field: the list is driven from it.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(row)}
              >
                <span className="fr-shortcuts-palette__icon" aria-hidden>
                  {row.recent && !query.trim() ? <Clock size={16} /> : Icon ? <Icon size={16} /> : null}
                </span>
                <span className="fr-shortcuts-palette__text">
                  <span className="fr-shortcuts-palette__label">
                    {entry.label}
                    {entry.detail && <span className="fr-shortcuts-palette__detail"> ({entry.detail})</span>}
                  </span>
                  {disabled && <span className="fr-shortcuts-palette__reason">{entry.disabledReason}</span>}
                </span>
                <span className="fr-shortcuts-palette__section">{entry.kind === 'tool' ? 'Tool' : row.section}</span>
                <span className="fr-shortcuts-palette__keys">
                  {row.keys.map((k) => (
                    <Kbd key={k} compact>
                      {k}
                    </Kbd>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="fr-shortcuts-palette__hint" aria-hidden>
        <Kbd compact>↑</Kbd> <Kbd compact>↓</Kbd> to choose · <Kbd compact>Enter</Kbd> to run · <Kbd compact>Esc</Kbd> to close
      </p>
    </Modal>
  );
}

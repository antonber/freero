// "Size and position" in the format toolbar: exact X / Y / W / H / rotation for the selection.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Ruler } from 'lucide-react';
import type { BoardElement } from '@freero/shared';
import { IconButton, Popover } from '@ui';
import type { Editor } from '../api';
import { applyExact, exactFrame, exactTargets, stepExact, type ExactField } from '../editor/exact';
import { MIXED, commonValue, type Mixed } from './TextStyleControls';

const FIELDS: ReadonlyArray<{ field: ExactField; label: string; name: string; unit?: string }> = [
  { field: 'x', label: 'X', name: 'X position' },
  { field: 'y', label: 'Y', name: 'Y position' },
  { field: 'w', label: 'W', name: 'Width' },
  { field: 'h', label: 'H', name: 'Height' },
  { field: 'rotation', label: '↻', name: 'Rotation', unit: '°' },
];

const show = (n: number) => String(Math.round(n * 10) / 10);

/** What a field shows for the selection: a number, MIXED, or null (no selected item takes it). */
function fieldValue(editor: Editor, els: BoardElement[], field: ExactField): Mixed<number> | null {
  if (field === 'x' || field === 'y') {
    const f = exactFrame(editor, els);
    return f ? Math.round(f[field] * 10) / 10 : null;
  }
  const targets = exactTargets(editor, els, field);
  if (!targets.length) return null;
  return commonValue(targets, (el) => Math.round((field === 'rotation' ? (((el.rotation || 0) % 360) + 360) % 360 : el[field]) * 10) / 10);
}

function NumberField(props: {
  label: string;
  name: string;
  unit?: string;
  value: Mixed<number> | null;
  autoFocus?: boolean;
  onCommit: (n: number) => void;
  step: (current: number, dir: -1 | 1, big: boolean) => number;
}) {
  const { value } = props;
  const shown = value === null ? '' : value === MIXED ? '' : show(value);
  const [draft, setDraft] = useState(shown);
  const focused = useRef(false);
  // Follow the board while the field isn't being typed in (undo, a collaborator's move).
  useEffect(() => {
    if (!focused.current) setDraft(shown);
  }, [shown]);

  const commit = () => {
    const n = Number(draft.trim().replace(/[°px]+$/i, '').replace(',', '.'));
    if (draft.trim() && Number.isFinite(n) && show(n) !== shown) props.onCommit(n);
    else setDraft(shown);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const base = Number(draft.replace(',', '.'));
      if (!draft.trim() || !Number.isFinite(base)) return;
      const next = props.step(base, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
      setDraft(show(next));
      props.onCommit(next);
    } else if (e.key === 'Escape' && draft !== shown) {
      // First Escape undoes the typing; the next one closes the popover.
      e.preventDefault();
      e.stopPropagation();
      setDraft(shown);
    }
  };
  const disabled = value === null;
  return (
    <label className={`fr-exact__field${disabled ? ' is-disabled' : ''}`}>
      <span className="fr-exact__label" aria-hidden>
        {props.label}
      </span>
      <input
        className="fr-exact__input"
        inputMode="decimal"
        aria-label={props.name}
        disabled={disabled}
        placeholder={value === MIXED ? 'Mixed' : disabled ? '–' : undefined}
        value={draft}
        autoFocus={props.autoFocus}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {props.unit && <span className="fr-exact__unit" aria-hidden>{props.unit}</span>}
    </label>
  );
}

export function ExactControls({ editor, selection }: { editor: Editor; selection: BoardElement[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton ref={ref} icon={Ruler} label="Size and position" size={32} active={open} aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} width={232} escapeToContent aria-label="Size and position">
        <div className="fr-exact" role="group" aria-label="Size and position">
          {FIELDS.map((f, i) => (
            <NumberField
              key={f.field}
              label={f.label}
              name={f.name}
              unit={f.unit}
              autoFocus={i === 0}
              value={fieldValue(editor, selection, f.field)}
              onCommit={(n) => applyExact(editor, selection.map((el) => editor.getElement(el.id) ?? el), f.field, n)}
              step={(cur, dir, big) => stepExact(editor, f.field, cur, dir, big)}
            />
          ))}
        </div>
        {selection.length > 1 && <p className="fr-exact__note">X and Y move the whole selection; size and rotation apply to each item.</p>}
      </Popover>
    </>
  );
}

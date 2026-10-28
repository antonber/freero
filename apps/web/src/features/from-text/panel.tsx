// "Insert from text": pick what the text is, paste or type it, watch the preview, insert it as one
// undo step. Opened on a diagram inserted earlier ("Edit diagram source"), it edits that diagram's
// source and lays it out again onto the same items.
import { useDeferredValue, useMemo, useState } from 'react';
import { TextCursorInput } from 'lucide-react';
import { LayoutError, type LaidOut } from '@freero/shared';
import { definePanel, type PanelProps, type Point } from '@engine';
import { Button, ElementsPreview, Modal, Select, TextArea, Toggle } from '@ui';
import { DIAGRAMS, DIALOG_ID, insertLaid, layoutText, previewElements, updateDiagram } from './lib/insert';
import { detectKind, KINDS, kindLabel, type TextKind } from './lib/parse';
import type { DiagramRecord } from './lib/reconcile';
import './from-text.css';

const isKind = (v: unknown): v is TextKind => KINDS.some((k) => k.value === v);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

function FromTextDialog({ editor, props }: PanelProps) {
  const diagramId = typeof props?.diagramId === 'string' ? props.diagramId : null;
  const record = useMemo(() => (diagramId ? editor.collection<DiagramRecord>(DIAGRAMS).get(diagramId) ?? null : null), [editor, diagramId]);
  const at = props?.at && typeof (props.at as Point).x === 'number' ? (props.at as Point) : undefined;
  const [kind, setKind] = useState<TextKind>(record?.kind ?? (isKind(props?.kind) ? props.kind : 'mindmap'));
  const [kindPicked, setKindPicked] = useState(!!record || isKind(props?.kind));
  const [text, setText] = useState(record?.source ?? (typeof props?.text === 'string' ? props.text : ''));
  const [keepMoved, setKeepMoved] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const close = () => editor.closePanel(DIALOG_ID);

  // The preview follows typing without blocking it.
  const deferred = useDeferredValue(text);
  const result = useMemo((): { laid: LaidOut } | { error: string } | null => {
    if (!deferred.trim()) return null;
    try {
      return { laid: layoutText(kind, deferred) };
    } catch (e) {
      return { error: e instanceof LayoutError ? e.message : 'This text can’t be laid out' };
    }
  }, [kind, deferred]);
  const laid = result && 'laid' in result ? result.laid : null;
  const elements = useMemo(() => (laid ? previewElements(laid) : []), [laid]);
  const meta = KINDS.find((k) => k.value === kind)!;
  const stale = deferred !== text;

  const onText = (next: string) => {
    setText(next);
    setFailure(null);
    if (!kindPicked) {
      const guess = detectKind(next);
      if (guess) setKind(guess);
    }
  };

  const submit = () => {
    if (!text.trim()) return;
    try {
      if (record && diagramId) {
        const r = updateDiagram(editor, diagramId, text, { keepMoved });
        close();
        editor.host.notify(`Diagram updated: ${[r.created && `${r.created} added`, r.updated && `${r.updated} changed`, r.removed && `${r.removed} removed`].filter(Boolean).join(', ') || 'nothing changed'}`, 'success');
      } else {
        const fresh = layoutText(kind, text);
        insertLaid(editor, kind, text, fresh, at);
        close();
        editor.host.notify(`${KINDS.find((k) => k.value === kind)!.noun} inserted. Undo takes it back.`, 'success');
      }
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'This text can’t be laid out');
    }
  };

  const error = failure ?? (result && 'error' in result ? result.error : null);
  return (
    <Modal
      open
      onClose={close}
      width={760}
      title={
        <span className="fr-from-text__title">
          <TextCursorInput size={18} aria-hidden /> {record ? 'Edit diagram source' : 'Insert from text'}
        </span>
      }
      footer={
        <>
          {record && <Toggle checked={keepMoved} onChange={setKeepMoved} label="Keep items I moved" className="fr-from-text__keep" />}
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!laid || stale}>
            {record ? 'Update diagram' : 'Insert'}
          </Button>
        </>
      }
    >
      <div className="fr-from-text">
        <div className="fr-from-text__input">
          <div className="fr-from-text__kind">
            {record ? (
              <span className="fr-from-text__fixed">{kindLabel(kind)}</span>
            ) : (
              <Select<TextKind>
                aria-label="What the text is"
                options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
                value={kind}
                onChange={(k) => {
                  setKind(k);
                  setKindPicked(true);
                  setFailure(null);
                }}
              />
            )}
          </div>
          <p className="fr-from-text__hint">{meta.hint}</p>
          <TextArea
            aria-label={`${meta.label} text`}
            className="fr-from-text__text"
            value={text}
            rows={14}
            spellCheck={false}
            placeholder={meta.placeholder}
            autoFocus
            onChange={(e) => onText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
              // Tab indents (outlines), Shift+Tab outdents the current line.
              if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                const ta = e.currentTarget;
                const { selectionStart: s, selectionEnd: end, value } = ta;
                const lineStart = value.lastIndexOf('\n', s - 1) + 1;
                if (e.shiftKey) {
                  const cut = value.startsWith('  ', lineStart) ? 2 : value.startsWith(' ', lineStart) ? 1 : 0;
                  if (!cut) return;
                  onText(value.slice(0, lineStart) + value.slice(lineStart + cut));
                  requestAnimationFrame(() => ta.setSelectionRange(Math.max(lineStart, s - cut), Math.max(lineStart, end - cut)));
                } else {
                  onText(value.slice(0, lineStart) + '  ' + value.slice(lineStart));
                  requestAnimationFrame(() => ta.setSelectionRange(s + 2, end + 2));
                }
              }
            }}
          />
        </div>
        <div className="fr-from-text__preview" aria-live="polite">
          {laid ? (
            <>
              <ElementsPreview elements={elements} label={`Preview: ${meta.label.toLowerCase()}`} className="fr-from-text__picture" />
              <p className="fr-from-text__summary">
                {plural(laid.elements.filter((e) => e.type !== 'connector').length, 'item')}
                {laid.elements.some((e) => e.type === 'connector') ? `, ${plural(laid.elements.filter((e) => e.type === 'connector').length, 'line')}` : ''}
                {record ? ' · items you styled keep their style' : ' · nothing is on the board until you insert'}
              </p>
            </>
          ) : (
            <div className="fr-from-text__empty">{error ? null : 'The preview shows here.'}</div>
          )}
          {error && (
            <p className="fr-from-text__error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default definePanel({
  id: DIALOG_ID,
  slot: 'dialog',
  order: 62,
  minRole: 'editor',
  Component: FromTextDialog,
});

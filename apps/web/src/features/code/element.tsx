import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react';
import { Check, Copy, SquareCode } from 'lucide-react';
import type { CodeElement } from '@freero/shared';
import { defineElement, useEditor, useIsExporting, type Editor, type ElementRenderProps, type NewElement } from '@engine';
import { AUTO, PLAIN, isKnownLanguage, languageLabel, parseFence } from './lib/languages';
import { highlightNow, highlighterReady, loadHighlighter, subscribeHighlighter } from './lib/tokens';
import { getEditingCode, setEditingCode, subscribeEditingCode } from './lib/editing';
import { CodeLines } from './lib/CodeLines';
import { DEFAULT_W, FONT_SIZE, HEAD_H, LINE_H, MIN_W, PAD_X, PAD_Y, gutterWidth, heightOf, lineCount } from './lib/layout';
import { codeAt, copyCode } from './lib/actions';
import './code.css';

/** Below this zoom code is unreadable: draw grey line bars instead (cheap on big boards). */
const LOD_ZOOM = 0.2;
const stop = (e: PointerEvent) => e.stopPropagation();

/**
 * Editing in place: a plain <textarea> laid over the code with the same metrics, so typing never
 * touches the rich-text path. The whole sitting is one gesture (one undo step); text reaches the
 * board a moment after each pause, and when editing ends.
 */
function CodeEditor({ el, editor }: { el: CodeElement; editor: Editor }) {
  const [text, setText] = useState(el.code);
  const textRef = useRef(text);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const cur = editor.getElement<CodeElement>(el.id);
    if (cur && cur.code !== textRef.current) editor.update<CodeElement>(el.id, { code: textRef.current });
  };
  useEffect(() => {
    editor.beginGesture();
    ref.current?.focus();
    return () => {
      flush();
      editor.endGesture();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (v: string) => {
    textRef.current = v;
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 200);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setEditingCode(null);
      return;
    }
    // Tab indents (a tab character, kept as typed) instead of leaving the field.
    if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const t = e.currentTarget;
      const { selectionStart: s, selectionEnd: end } = t;
      const v = text.slice(0, s) + '\t' + text.slice(end);
      change(v);
      requestAnimationFrame(() => t.setSelectionRange(s + 1, s + 1));
    }
  };

  return (
    <textarea
      ref={ref}
      className="fr-code__input"
      data-fr-interactive=""
      aria-label="Code"
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      autoCorrect="off"
      wrap="off"
      value={text}
      onPointerDown={stop}
      onChange={(e) => change(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => setEditingCode(null)}
    />
  );
}

function CopyButton({ code }: { code: string }) {
  const editor = useEditor();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className="fr-code__copy"
      data-fr-interactive=""
      title="Copy code"
      aria-label="Copy code"
      onPointerDown={stop}
      onClick={(e) => {
        e.stopPropagation();
        void copyCode(editor, code).then((ok) => setDone(ok));
      }}
    >
      {done ? <Check size={14} strokeWidth={2.4} /> : <Copy size={14} strokeWidth={2} />}
    </button>
  );
}

const CodeView = memo(function CodeView({ element: el, selected, zoom }: ElementRenderProps<CodeElement>) {
  const editor = useEditor();
  const exporting = useIsExporting();
  const ready = useSyncExternalStore(subscribeHighlighter, highlighterReady);
  const editingId = useSyncExternalStore(subscribeEditingCode, getEditingCode);
  const editing = !exporting && editingId === el.id;
  // A language a newer client stored that this one doesn't know reads as plain text.
  const language = isKnownLanguage(el.language) ? el.language : PLAIN;
  const result = useMemo(() => highlightNow(el.code, language), [el.code, language, ready]);

  // Deselecting ends this client's edit session.
  useEffect(() => {
    if (editing && !selected) setEditingCode(null);
  }, [editing, selected]);

  const gutter = gutterWidth(el);
  const lod = zoom < LOD_ZOOM && !editing;
  const label = language === AUTO ? (result.detected ? languageLabel(result.detected) : 'Code') : languageLabel(language);
  return (
    <div className={`fr-code is-${el.theme === 'dark' ? 'dark' : 'light'}`} style={{ fontSize: FONT_SIZE, lineHeight: `${LINE_H}px` }}>
      <div className="fr-code__head" style={{ height: HEAD_H }}>
        <span className="fr-code__dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className="fr-code__lang">{label}</span>
        {!exporting && !lod && <CopyButton code={el.code} />}
      </div>
      {lod ? (
        <div className="fr-code__bars" aria-hidden style={{ padding: `${PAD_Y}px ${PAD_X}px` }}>
          {Array.from({ length: Math.min(12, lineCount(el.code)) }, (_, i) => (
            <span key={i} style={{ width: `${40 + ((i * 37) % 50)}%` }} />
          ))}
        </div>
      ) : (
        <div className="fr-code__body" style={{ padding: `${PAD_Y}px ${PAD_X}px ${PAD_Y}px 0` }}>
          {el.lineNumbers && (
            <div className="fr-code__gutter" style={{ width: gutter }} aria-hidden>
              {Array.from({ length: lineCount(el.code) }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          )}
          <div className="fr-code__text" style={{ paddingLeft: el.lineNumbers ? 0 : PAD_X }}>
            {editing ? <CodeEditor el={el} editor={editor} /> : el.code ? <CodeLines lines={result.lines} /> : <div className="fr-code__placeholder">Double-click to write code</div>}
          </div>
        </div>
      )}
    </div>
  );
});

export default defineElement({
  type: 'code',
  label: { one: 'Code block', many: 'Code blocks' },
  icon: SquareCode,
  resize: 'width-only',
  minSize: { w: MIN_W, h: heightOf('') },
  defaults: (): Omit<NewElement<'code'>, 'x' | 'y'> => ({
    type: 'code',
    code: '',
    language: AUTO,
    lineNumbers: true,
    theme: 'light',
    w: DEFAULT_W,
    h: heightOf(''),
  }),
  Component: CodeView,
  toPlainText: (el) => el.code,
  // Lines never wrap: the height follows the line count.
  normalize(el) {
    const h = heightOf(el.code ?? '');
    return h !== el.h ? { h } : null;
  },
  onDoubleClick(el) {
    void loadHighlighter();
    setEditingCode(el.id);
  },
  keys: [{ shortcuts: ['enter'], label: 'Edit the code' }],
  onKeyDown(e, { editor, selection }) {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
    const el = selection.length === 1 && selection[0].type === 'code' ? selection[0] : null;
    if (!el || el.locked || !editor.can('editor')) return false;
    setEditingCode(el.id);
    return true;
  },
  // A pasted Markdown fence (```ts … ```) becomes a code block, its indentation intact. Ahead of the
  // diagram importer (whose ```mermaid fences are left to it) and of lists and text boxes.
  importPriority: 45,
  importData(editor, data, at) {
    if (data.files.length) return false;
    const fence = parseFence(data.text);
    if (!fence) return false;
    void loadHighlighter();
    editor.create<'code'>(codeAt(at, { code: fence.code, language: fence.language }), { select: true });
    return true;
  },
});

// <ElementText>: renders an element's rich-text field; swaps to the shared contenteditable
// editor while the element is being edited. Handles fontSize 'auto' (fit to box), vertical
// alignment, placeholder, IME, batching (one undo step per edit session) and paste-as-text.
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useContext,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import { useStore } from 'zustand';
import type { BoardElement, FontFamily, TextAlign, VerticalAlign } from '@freero/shared';
import { RenderModeContext, useCore } from '../context';
import { plainToRichText, richTextToPlain, sanitizeRichText } from './sanitize';
import { autoMaxFont, fitFontSize, FONT_VARS, getFontEpoch, LINE_HEIGHT, subscribeFontEpoch } from './autofit';
import type { FormatCommand, TextFormatState, TextSession } from './session';
import './text.css';

export interface ElementTextProps {
  element: BoardElement;
  /** Field holding the RichText. Defaults to the definition's textField, then 'text'. */
  field?: string;
  /** Shown while editing an empty text. */
  placeholder?: string;
  /** Inner padding in world px. Default 12. */
  padding?: number;
  className?: string;
  style?: CSSProperties;
  // Overrides; by default read from the element's TextStyle fields when present.
  fontSize?: number | 'auto';
  fontFamily?: FontFamily;
  color?: string;
  align?: TextAlign;
  vAlign?: VerticalAlign;
  /** Bounds for fontSize 'auto'. Default min 6, max proportional to the box. */
  minFontSize?: number;
  maxFontSize?: number;
}

const sanitizeCache = new Map<string, string>();
function cachedSanitize(html: string): string {
  let out = sanitizeCache.get(html);
  if (out === undefined) {
    out = sanitizeRichText(html);
    if (sanitizeCache.size > 5000) sanitizeCache.clear();
    sanitizeCache.set(html, out);
  }
  return out;
}

const JUSTIFY: Record<VerticalAlign, string> = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };

function useFontEpoch() {
  return useSyncExternalStore(subscribeFontEpoch, getFontEpoch);
}

function ElementTextImpl(props: ElementTextProps) {
  const core = useCore();
  const { element } = props;
  const def = core.editor.getDefinition(element.type);
  const field = props.field ?? def?.textField ?? 'text';
  const rec = element as unknown as Record<string, unknown>;
  const html = String(rec[field] ?? '');
  const exporting = useContext(RenderModeContext) === 'export';
  const editingLive = useStore(core.ui, (s) => s.editingId === element.id);
  const editing = editingLive && !exporting;
  const pad = props.padding ?? 12;
  const family = (props.fontFamily ?? (rec.fontFamily as FontFamily | undefined) ?? 'sans') as FontFamily;
  const fontSizeSetting = props.fontSize ?? (rec.fontSize as number | 'auto' | undefined) ?? 'auto';
  const align = props.align ?? (rec.align as TextAlign | undefined) ?? 'center';
  const vAlign = props.vAlign ?? (rec.vAlign as VerticalAlign | undefined) ?? 'middle';
  const color = props.color ?? (rec.textColor as string | undefined) ?? 'var(--fr-ink)';
  const innerW = Math.max(1, element.w - pad * 2);
  const innerH = Math.max(1, element.h - pad * 2);

  // While editing, auto-fit follows the live (uncommitted) text.
  const [livePlain, setLivePlain] = useState<string | null>(null);
  useEffect(() => {
    if (!editing) setLivePlain(null);
  }, [editing]);
  const epoch = useFontEpoch();
  const plain = livePlain ?? richTextToPlain(html);
  const fontSize = useMemo(() => {
    if (fontSizeSetting !== 'auto') return fontSizeSetting;
    return fitFontSize(plain, family, innerW, innerH, {
      min: props.minFontSize ?? 6,
      max: props.maxFontSize ?? autoMaxFont(element.w, element.h),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontSizeSetting, plain, family, innerW, innerH, element.w, element.h, props.minFontSize, props.maxFontSize, epoch]);

  const boxStyle: CSSProperties = {
    padding: pad,
    justifyContent: JUSTIFY[vAlign],
    textAlign: align,
    fontSize,
    lineHeight: LINE_HEIGHT,
    fontFamily: FONT_VARS[family],
    color,
    ...props.style,
  };

  if (editing) {
    return (
      <TextEditor
        id={element.id}
        field={field}
        html={html}
        className={props.className}
        style={boxStyle}
        placeholder={props.placeholder ?? 'Type something…'}
        onLiveText={setLivePlain}
      />
    );
  }
  const safe = cachedSanitize(html);
  return (
    <div className={`fr-text ${props.className ?? ''}`} style={boxStyle}>
      <div className="fr-text-content" dangerouslySetInnerHTML={{ __html: safe }} />
    </div>
  );
}

export const ElementText = memo(ElementTextImpl);

// ---------------------------------------------------------------------------------------------

interface TextEditorProps {
  id: string;
  field: string;
  html: string;
  className?: string;
  style: CSSProperties;
  placeholder: string;
  onLiveText(text: string): void;
}

const FLUSH_MS = 160;

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function selectAllIn(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function selectionInside(el: HTMLElement): boolean {
  const sel = window.getSelection();
  return !!sel && sel.rangeCount > 0 && el.contains(sel.anchorNode);
}

function TextEditor(props: TextEditorProps) {
  const core = useCore();
  const ref = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWritten = useRef(props.html);
  const [empty, setEmpty] = useState(!richTextToPlain(props.html).trim());
  const request = useStore(core.ui, (s) => (s.editRequest?.id === props.id ? s.editRequest : null));

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const el = ref.current;
    if (!el || composing.current) return;
    const html = sanitizeRichText(el.innerHTML);
    if (html === lastWritten.current) return;
    lastWritten.current = html;
    core.editor.update(props.id, { [props.field]: html } as never);
  }, [core, props.id, props.field]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, FLUSH_MS);
  }, [flush]);

  // Latest props in refs so the callbacks (and the effects depending on them) stay stable.
  const onLiveText = useRef(props.onLiveText);
  onLiveText.current = props.onLiveText;
  const htmlRef = useRef(props.html);
  htmlRef.current = props.html;

  const refreshLive = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const plain = richTextToPlain(el.innerHTML);
    onLiveText.current(plain);
    setEmpty(!plain.trim());
  }, []);

  // Mount: fill content once (uncontrolled afterwards), focus, place caret.
  useLayoutEffect(() => {
    const el = ref.current!;
    el.innerHTML = sanitizeRichText(props.html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !request) return;
    el.focus({ preventScroll: true });
    if (request.initialText !== undefined) {
      // Typing on a selected element: empty → start with the typed text; otherwise append
      // (never silently replace existing content).
      if (!richTextToPlain(htmlRef.current).trim()) el.innerHTML = plainToRichText(request.initialText);
      else {
        el.innerHTML = sanitizeRichText(htmlRef.current);
        placeCaretAtEnd(el);
        document.execCommand('insertText', false, request.initialText);
      }
      placeCaretAtEnd(el);
      refreshLive();
      schedule();
    } else if (request.selectAll) selectAllIn(el);
    else placeCaretAtEnd(el);
  }, [request, refreshLive, schedule]);

  // Register the session so editor.formatText / getTextFormatState reach the live DOM.
  useEffect(() => {
    const el = ref.current!;
    const exec = (cmd: FormatCommand, value?: string) => {
      el.focus({ preventScroll: true });
      const sel = window.getSelection();
      const collapsed = !selectionInside(el) || !!sel?.isCollapsed;
      if (collapsed && cmd !== 'bullets' && cmd !== 'numbers') selectAllIn(el);
      document.execCommand('styleWithCSS', false, (cmd === 'color' || cmd === 'highlight') as unknown as string);
      switch (cmd) {
        case 'bold': document.execCommand('bold'); break;
        case 'italic': document.execCommand('italic'); break;
        case 'underline': document.execCommand('underline'); break;
        case 'strike': document.execCommand('strikeThrough'); break;
        case 'bullets': document.execCommand('insertUnorderedList'); break;
        case 'numbers': document.execCommand('insertOrderedList'); break;
        case 'color': document.execCommand('foreColor', false, value ?? 'inherit'); break;
        case 'highlight': document.execCommand('hiliteColor', false, value ?? 'transparent'); break;
        case 'clear': document.execCommand('removeFormat'); document.execCommand('unlink'); break;
        case 'link':
          if (value) document.execCommand('createLink', false, value);
          else document.execCommand('unlink');
          break;
      }
      if (collapsed) placeCaretAtEnd(el);
      refreshLive();
      flush();
    };
    const state = (): TextFormatState => {
      const q = (c: string) => {
        try {
          return document.queryCommandState(c);
        } catch {
          return false;
        }
      };
      const sel = window.getSelection();
      const anchor = sel?.anchorNode;
      const a = anchor && el.contains(anchor) ? (anchor.nodeType === 1 ? (anchor as Element) : anchor.parentElement)?.closest('a') : null;
      return {
        bold: q('bold'),
        italic: q('italic'),
        underline: q('underline'),
        strike: q('strikeThrough'),
        bullets: q('insertUnorderedList'),
        numbers: q('insertOrderedList'),
        link: a?.getAttribute('href') ?? null,
      };
    };
    const insertText = (text: string) => {
      el.focus({ preventScroll: true });
      if (!selectionInside(el)) placeCaretAtEnd(el);
      document.execCommand('insertText', false, text);
      refreshLive();
      schedule();
    };
    const session: TextSession = { id: props.id, field: props.field, flush, exec, state, insertText };
    core.text = session;
    let raf = 0;
    const onSel = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        core.ui.setState((s) => ({ textStateVersion: s.textStateVersion + 1 }));
      });
    };
    document.addEventListener('selectionchange', onSel);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      if (raf) cancelAnimationFrame(raf);
      flush();
      if (core.text === session) core.text = null;
    };
  }, [core, props.id, props.field, flush, refreshLive, schedule]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const sel = window.getSelection();
      const inList = !!(sel?.anchorNode && (sel.anchorNode.nodeType === 1 ? (sel.anchorNode as Element) : sel.anchorNode.parentElement)?.closest('li'));
      if (!inList) {
        e.preventDefault();
        document.execCommand('insertLineBreak');
      }
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    // Paste as plain text: foreign HTML never enters the board.
    e.preventDefault();
    e.stopPropagation();
    const text = e.clipboardData.getData('text/plain');
    if (text) document.execCommand('insertText', false, text);
  };

  const onBlur = () => {
    // Commit when focus truly leaves (not when the window loses focus or a toolbar is clicked).
    setTimeout(() => {
      if (!document.hasFocus()) return;
      const active = document.activeElement;
      if (active && ref.current?.contains(active)) return;
      if (active instanceof HTMLElement && active.closest('[data-fr-format-toolbar], [data-fr-keep-editing], [role="dialog"], [role="menu"]')) return;
      if (core.ui.getState().editingId === props.id) core.editor.stopEditing();
    }, 0);
  };

  const onContainerMouseDown = (e: React.MouseEvent) => {
    // Clicks in the padding/empty area keep editing and put the caret at the end.
    if (e.target === e.currentTarget && ref.current) {
      e.preventDefault();
      ref.current.focus({ preventScroll: true });
      placeCaretAtEnd(ref.current);
    }
  };

  return (
    <div
      className={`fr-text fr-text--editing ${props.className ?? ''}`}
      style={props.style}
      data-fr-text-editor=""
      onMouseDown={onContainerMouseDown}
    >
      <div
        ref={ref}
        className={`fr-text-content fr-text-input${empty ? ' is-empty' : ''}`}
        data-placeholder={props.placeholder}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        role="textbox"
        aria-multiline="true"
        onInput={() => {
          refreshLive();
          if (!composing.current) schedule();
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          refreshLive();
          schedule();
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={onBlur}
      />
    </div>
  );
}

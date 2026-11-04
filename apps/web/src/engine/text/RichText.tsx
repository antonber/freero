// Rich text outside the canvas (a card's details): <RichTextView> shows it formatted, its links
// opening in a new tab; <RichTextEditor> edits it in place with the same stack as ElementText (a
// contenteditable driven by execCommand, sanitized on the way out, Enter = line break outside
// lists, paste as plain text), plus Markdown-style typing when asked (markdownTyping.ts).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ExternalLink } from 'lucide-react';
import { isSafeHref, richTextToPlain, sanitizeRichText } from './sanitize';
import { caretInList, enterAsLineBreak, pasteAsPlainText, plainSpaces } from './editing';
import { applyMarkdownShortcut } from './markdownTyping';
import { t } from '../messages';
import './richtext.css';

/** Links in shown rich text open in a new tab that can't reach back into the board. */
function openLinksInNewTab(root: HTMLElement) {
  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
}

export interface RichTextViewProps {
  html: string;
  /** Shown when there is no text. */
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  /** Focused first when it opens in a dialog (ui Modal's data-autofocus). */
  autoFocus?: boolean;
}

/** [additive] Rich text shown read-only, formatted (lists, bold, code, links in a new tab). */
export function RichTextView({ html, placeholder, className, autoFocus, ...aria }: RichTextViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const safe = useMemo(() => sanitizeRichText(html), [html]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = safe;
    openLinksInNewTab(el);
  }, [safe]);
  return (
    <div
      ref={ref}
      className={`fr-richtext${safe ? '' : ' is-empty'} ${className ?? ''}`}
      data-placeholder={placeholder}
      role="region"
      aria-label={aria['aria-label']}
      // Scrollable text a keyboard can reach (and the dialog focuses first).
      tabIndex={0}
      data-autofocus={autoFocus ? '' : undefined}
    />
  );
}

export interface RichTextEditorProps {
  /** The rich text it starts with (read once: the editor is uncontrolled afterwards). */
  html: string;
  /** Every change, sanitized. */
  onChange(html: string): void;
  onFocus?(): void;
  onBlur?(): void;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  /** Focused first when it opens in a dialog (ui Modal's data-autofocus). */
  autoFocus?: boolean;
  /** "1. " / "- " start lists; **bold**, *italic*, `code`, [label](url) and web addresses format as typed. */
  markdownShortcuts?: boolean;
}

/**
 * [additive] Rich text edited in place, outside the canvas. Tab / Shift+Tab nest and un-nest a
 * list item; Ctrl/Cmd+click opens a link, and with the caret in a link a chip below offers it too.
 */
export function RichTextEditor(props: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const [empty, setEmpty] = useState(() => !richTextToPlain(props.html).trim());
  const [link, setLink] = useState<{ href: string; top: number; start: number } | null>(null);
  const onChange = useRef(props.onChange);
  onChange.current = props.onChange;

  useLayoutEffect(() => {
    ref.current!.innerHTML = sanitizeRichText(props.html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changed = useCallback(() => {
    const el = ref.current;
    if (!el || composing.current) return;
    const html = plainSpaces(sanitizeRichText(el.innerHTML));
    setEmpty(!richTextToPlain(html).trim());
    onChange.current(html);
  }, []);

  // The link the caret is in, for the chip that opens it.
  useEffect(() => {
    const onSel = () => {
      const el = ref.current;
      const box = boxRef.current;
      const sel = window.getSelection();
      const n = sel?.anchorNode;
      const a = n && el?.contains(n) && sel?.isCollapsed ? (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest('a[href]') : null;
      const href = a?.getAttribute('href') ?? '';
      if (!a || !box || !isSafeHref(href)) return setLink(null);
      const r = a.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const rtl = getComputedStyle(box).direction === 'rtl';
      setLink({ href, top: r.bottom - b.top + 4, start: Math.max(0, rtl ? b.right - r.right : r.left - b.left) });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || !ref.current) return;
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && caretInList()) {
      // Nest / un-nest the list item (and keep focus in the editor).
      e.preventDefault();
      e.stopPropagation();
      document.execCommand(e.shiftKey ? 'outdent' : 'indent');
      return changed();
    }
    const plainKey = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (props.markdownShortcuts && plainKey && (e.key === ' ' || e.key === 'Enter') && !e.shiftKey) {
      if (applyMarkdownShortcut(ref.current, e.key)) {
        e.preventDefault();
        return changed();
      }
    }
    if (enterAsLineBreak(e)) changed();
  };

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    const href = (e.target as Element).closest?.('a[href]')?.getAttribute('href');
    if (!href || !isSafeHref(href)) return;
    e.preventDefault();
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  return (
    <div ref={boxRef} className={`fr-richtext-field ${props.className ?? ''}`}>
      <div
        ref={ref}
        className={`fr-richtext fr-richtext--editing${empty ? ' is-empty' : ''}`}
        data-placeholder={props.placeholder}
        contentEditable
        suppressContentEditableWarning
        spellCheck
        role="textbox"
        aria-multiline="true"
        aria-label={props['aria-label']}
        tabIndex={0}
        data-autofocus={props.autoFocus ? '' : undefined}
        onInput={changed}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          changed();
        }}
        onKeyDown={onKeyDown}
        onPaste={pasteAsPlainText}
        onClick={onClick}
        onFocus={props.onFocus}
        onBlur={() => {
          setLink(null);
          props.onBlur?.();
        }}
      />
      {link && (
        <a
          className="fr-richtext-field__link"
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ top: link.top, insetInlineStart: link.start }}
          aria-label={t('openLinkInNewTab')}
          title={t('openLinkInNewTab')}
          // Keeps the caret (and the editing sitting) where it is.
          onMouseDown={(e) => e.preventDefault()}
        >
          <ExternalLink size={12} aria-hidden />
          <span>{link.href}</span>
        </a>
      )}
    </div>
  );
}

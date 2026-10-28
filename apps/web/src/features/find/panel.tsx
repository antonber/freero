import { useEffect, useRef } from 'react';
import { CaseSensitive, ChevronDown, ChevronUp, Replace, Search, TextSearch } from 'lucide-react';
import { definePanel, useCamera, useCanEdit, type Editor } from '@engine';
import { Button, IconButton, Input } from '@ui';
import { PANEL_ID, replaceMatches, revealMatch, type Match } from './lib/search';
import { setFindUi, useFindUi } from './lib/state';
import { typeInfo } from './lib/types';
import { useMatches } from './lib/useMatches';
import './find.css';

const MAX_ROWS = 200;

function context(m: Match): string {
  const s = m.source;
  const parts = s.kind === 'element' ? [typeInfo(s.type).name, s.frameTitle && `in ${s.frameTitle}`] : [`Comment by ${s.author}`];
  if (m.count > 1) parts.push(`${m.count} matches`);
  return parts.filter(Boolean).join(' · ');
}

function FindPanel({ editor }: { editor: Editor }) {
  const matches = useMatches(editor);
  const canEdit = useCanEdit();
  const query = useFindUi(editor, (s) => s.query);
  const replacement = useFindUi(editor, (s) => s.replacement);
  const caseSensitive = useFindUi(editor, (s) => s.caseSensitive);
  const showReplace = useFindUi(editor, (s) => s.showReplace) && canEdit;
  const currentKey = useFindUi(editor, (s) => s.currentKey);
  const focusNonce = useFindUi(editor, (s) => s.focusNonce);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const index = matches.findIndex((m) => m.source.key === currentKey);

  // Opened (or Ctrl/⌘+F again): the cursor goes to the search box, its text selected.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusNonce]);

  useEffect(() => {
    if (index < 0) return;
    listRef.current?.querySelector(`[data-key="${CSS.escape(matches[index].source.key)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index, matches]);

  const go = (i: number) => {
    if (!matches.length) return;
    const m = matches[((i % matches.length) + matches.length) % matches.length];
    setFindUi(editor, { currentKey: m.source.key });
    revealMatch(editor, m);
  };
  const step = (dir: 1 | -1) => go(index < 0 ? (dir > 0 ? 0 : matches.length - 1) : index + dir);
  const opts = { caseSensitive };

  const replaceCurrent = () => {
    const m = matches[index < 0 ? 0 : index];
    if (!m) return;
    const s = m.source;
    const el = s.kind === 'element' ? editor.getElement(s.id) : undefined;
    const { changed } = replaceMatches(editor, [m], query, replacement, opts);
    if (!changed) {
      editor.host.notify(
        s.kind === 'comment'
          ? `Only ${s.author} can edit their comment.`
          : el?.locked
            ? 'Unlock this item to replace its text.'
            : 'This match can’t be replaced here.',
        'info',
      );
      return step(1);
    }
    setFindUi(editor, (st) => ({ revision: st.revision + 1 }));
    // The replaced text usually drops out of the results: the next one is now at the same index.
    const next = matches.filter((x) => x !== m);
    const after = next[Math.min(index < 0 ? 0 : index, next.length - 1)];
    setFindUi(editor, { currentKey: after?.source.key ?? null });
    if (after) revealMatch(editor, after);
  };

  const replaceEverywhere = () => {
    const { changed: n, othersComments } = replaceMatches(editor, matches, query, replacement, opts);
    setFindUi(editor, (st) => ({ revision: st.revision + 1 }));
    const left = othersComments ? ` · ${othersComments} comment${othersComments === 1 ? '' : 's'} by others left as written` : '';
    editor.host.notify(n ? `Replaced in ${n} item${n === 1 ? '' : 's'}${left}` : `Nothing to replace${left}`, n ? 'success' : 'info');
  };

  return (
    <div className="fr-find">
      <div className="fr-find__head">
        <h2 className="fr-find__title">Find on board</h2>
        <IconButton
          icon={CaseSensitive}
          label="Match case"
          size={32}
          active={caseSensitive}
          onClick={() => setFindUi(editor, { caseSensitive: !caseSensitive, currentKey: null })}
        />
        {canEdit && (
          <IconButton icon={Replace} label="Replace" size={32} active={showReplace} onClick={() => setFindUi(editor, { showReplace: !showReplace })} />
        )}
      </div>
      <div className="fr-find__bar">
        <Input
          ref={inputRef}
          size="sm"
          icon={Search}
          className="fr-find__input"
          placeholder="Search text, titles, comments"
          aria-label="Find on board"
          value={query}
          suffix={query ? <span className="fr-find__count">{matches.length ? `${index + 1 || '–'}/${matches.length}` : '0'}</span> : undefined}
          onChange={(e) => setFindUi(editor, { query: e.target.value, currentKey: null })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              editor.closePanel(PANEL_ID);
            }
          }}
        />
        <IconButton icon={ChevronUp} label="Previous match" shortcut="Shift+Enter" size={32} disabled={!matches.length} onClick={() => step(-1)} />
        <IconButton icon={ChevronDown} label="Next match" shortcut="Enter" size={32} disabled={!matches.length} onClick={() => step(1)} />
      </div>
      {showReplace && (
        <div className="fr-find__replace">
          <Input
            size="sm"
            className="fr-find__input"
            placeholder="Replace with"
            aria-label="Replace with"
            value={replacement}
            onChange={(e) => setFindUi(editor, { replacement: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                replaceCurrent();
              }
            }}
          />
          <Button size="sm" variant="secondary" disabled={!matches.length} onClick={replaceCurrent}>
            Replace
          </Button>
          <Button size="sm" variant="secondary" disabled={!matches.length} onClick={replaceEverywhere}>
            All
          </Button>
        </div>
      )}
      {!query.trim() ? (
        <div className="fr-find__empty">
          <TextSearch size={28} strokeWidth={1.5} />
          <span>Search every sticky, shape, card, table, mind map, frame title, connector label and comment.</span>
        </div>
      ) : !matches.length ? (
        <div className="fr-find__empty">
          <strong>No results</strong>
          <span>Nothing on this board matches “{query}”.</span>
        </div>
      ) : (
        <ul className="fr-find__results" ref={listRef} aria-label="Results">
          {matches.slice(0, MAX_ROWS).map((m, i) => {
            const { icon: Icon } = typeInfo(m.source.kind === 'element' ? m.source.type : 'comment');
            return (
              <li key={m.source.key} data-key={m.source.key}>
                <button
                  type="button"
                  className={`fr-find__row${i === index ? ' is-current' : ''}`}
                  aria-current={i === index || undefined}
                  onClick={() => {
                    go(i);
                    if (m.source.kind === 'element') editor.select([m.source.id]);
                  }}
                >
                  <span className="fr-find__icon">
                    <Icon size={16} />
                  </span>
                  <span className="fr-find__text">
                    <span className="fr-find__snippet">
                      {m.snippet.before}
                      <mark>{m.snippet.hit}</mark>
                      {m.snippet.after}
                    </span>
                    <span className="fr-find__ctx">{context(m)}</span>
                  </span>
                </button>
              </li>
            );
          })}
          {matches.length > MAX_ROWS && <li className="fr-find__more">+{matches.length - MAX_ROWS} more — refine the search</li>}
        </ul>
      )}
    </div>
  );
}

/** World-space highlight around every match while the panel is open; the current one stands out. */
function Highlights({ editor }: { editor: Editor }) {
  const matches = useMatches(editor);
  const currentKey = useFindUi(editor, (s) => s.currentKey);
  const zoom = useCamera().zoom;
  if (!matches.length) return null;
  const px = 1 / zoom;
  return (
    <>
      {matches.map((m) => {
        const current = m.source.key === currentKey;
        const cls = `fr-find-hl${current ? ' is-current' : ''}`;
        if (m.source.kind === 'comment') {
          const r = 16 * px;
          return (
            <div
              key={m.source.key}
              className={`${cls} fr-find-hl--pin`}
              style={{ left: m.source.at.x - r, top: m.source.at.y - r * 2, width: r * 2, height: r * 2, borderWidth: (current ? 3 : 2) * px }}
            />
          );
        }
        const el = editor.getElement(m.source.id);
        if (!el) return null;
        const pad = 4 * px;
        return (
          <div
            key={m.source.key}
            className={cls}
            style={{
              left: el.x - pad,
              top: el.y - pad,
              width: el.w + pad * 2,
              height: el.h + pad * 2,
              borderWidth: (current ? 3 : 2) * px,
              borderRadius: 6 * px,
              transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
            }}
          />
        );
      })}
    </>
  );
}

export default [
  definePanel({ id: PANEL_ID, slot: 'dock-right', order: 40, minRole: 'viewer', Component: FindPanel }),
  definePanel({ id: 'find.highlights', slot: 'world-overlay', order: 60, minRole: 'viewer', Component: Highlights }),
];

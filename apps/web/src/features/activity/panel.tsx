import { useEffect } from 'react';
import { Activity, ChevronLeft, ChevronRight, History, List, LocateFixed, RotateCw, Sparkles, X } from 'lucide-react';
import type { ActivityEntry, CatchUpItem } from '@freero/shared';
import { definePanel, describeElementType, useCamera, useEditor, useElement, type Editor, type PanelProps } from '@engine';
import { Avatar, AvatarStack, Button, IconButton, Spinner, Tooltip } from '@ui';
import { PANEL_ID } from './lib/ids';
import { ago, useActivity } from './lib/feed';
import {
  countsText,
  dismiss,
  endHighlight,
  goToItem,
  loadSummary,
  locateEntry,
  peopleText,
  showChanges,
  sinceText,
  step,
  totalChanges,
  useCatchUp,
  type MarkKind,
} from './lib/catchUp';
import './activity.css';

function Entry({ editor, e, now }: { editor: Editor; e: ActivityEntry; now: number }) {
  const locatable = !!e.items?.length;
  const body = (
    <>
      <Avatar name={e.actorName} color={e.actor?.color ?? '#8a89a3'} src={e.actor?.avatarUrl ?? null} size={28} />
      <div className="fr-activity__main">
        <span className="fr-activity__text">
          <strong>{e.actorName}</strong> {e.text}
        </span>
        <time className="fr-activity__time" dateTime={new Date(e.at).toISOString()}>
          {ago(e.at, now)}
        </time>
      </div>
      {locatable && <LocateFixed className="fr-activity__locate" size={15} aria-hidden />}
    </>
  );
  return (
    <li className="fr-activity__entry">
      {locatable ? (
        <button type="button" className="fr-activity__go" title="Show on the board" onClick={() => locateEntry(editor, e)}>
          {body}
        </button>
      ) : (
        <div className="fr-activity__go">{body}</div>
      )}
    </li>
  );
}

function ChangeRow({ editor, item, mark, current }: { editor: Editor; item: CatchUpItem; mark: MarkKind | 'removed'; current: boolean }) {
  const type = describeElementType(editor, item.kind);
  const Icon = type.icon;
  const text = item.text || type.one;
  const who = item.by.length ? ` · ${peopleText(item.by)}` : '';
  const inner = (
    <>
      <span className={`fr-activity__mark fr-activity__mark--${mark}`}>
        <Icon size={14} />
      </span>
      <span className="fr-activity__change">
        <span className="fr-activity__change-text">{text}</span>
        {item.before !== undefined && item.before !== item.text && <span className="fr-activity__before">was “{item.before || 'empty'}”</span>}
        <span className="fr-activity__time">
          {type.one}
          {item.frame ? ` in ${item.frame}` : ''}
          {who}
        </span>
      </span>
    </>
  );
  return (
    <li>
      {mark === 'removed' ? (
        <div className="fr-activity__changerow is-removed">{inner}</div>
      ) : (
        <button type="button" className={`fr-activity__changerow${current ? ' is-current' : ''}`} onClick={() => goToItem(editor, item.id)}>
          {inner}
        </button>
      )}
    </li>
  );
}

/** "Since your last visit": what others added, changed and removed, once loaded. */
function SinceVisit({ editor }: { editor: Editor }) {
  const changes = useCatchUp(editor, (s) => s.changes);
  const highlight = useCatchUp(editor, (s) => s.highlight);
  const dismissed = useCatchUp(editor, (s) => s.dismissed);
  if (!changes || dismissed) return null;
  const currentId = highlight?.source === 'catch-up' && highlight.index >= 0 ? highlight.items[highlight.index]?.id : null;
  const groups: Array<[string, CatchUpItem[], MarkKind | 'removed']> = [
    ['Added', changes.added, 'added'],
    ['Changed', changes.changed, 'changed'],
    ['Removed', changes.removed, 'removed'],
  ];
  return (
    <section className="fr-activity__since" aria-label="Since your last visit">
      <h3 className="fr-activity__subtitle">
        Since your last visit{changes.since ? <span> · {sinceText(changes.since)}</span> : null}
      </h3>
      {groups.map(([title, items, mark]) =>
        items.length ? (
          <div key={mark} className="fr-activity__group">
            <h4>
              {title} <span>{items.length}</span>
            </h4>
            <ul>
              {items.map((i) => (
                <ChangeRow key={i.id} editor={editor} item={i} mark={mark} current={i.id === currentId} />
              ))}
            </ul>
          </div>
        ) : null,
      )}
      {changes.truncated && <p className="fr-activity__note">More changed than is listed here.</p>}
    </section>
  );
}

function ActivityPanel({ editor }: PanelProps) {
  const { entries, hasMore, loading, error, refresh, more } = useActivity(editor);
  const now = Date.now();
  return (
    <div className="fr-activity">
      <h2 className="fr-activity__title">
        Activity
        <IconButton icon={RotateCw} size={32} label="Refresh" disabled={loading} onClick={refresh} />
      </h2>
      <SinceVisit editor={editor} />
      {error && (
        <div className="fr-activity__error" role="alert">
          {error}
          <Button size="sm" variant="ghost" onClick={refresh}>
            Try again
          </Button>
        </div>
      )}
      {entries === null && !error ? (
        <div className="fr-activity__empty">
          <Spinner size={18} />
        </div>
      ) : entries && entries.length === 0 ? (
        <div className="fr-activity__empty">
          <Activity size={22} aria-hidden />
          <p>Nothing yet. What people add, change and comment on shows up here a minute after they pause.</p>
        </div>
      ) : (
        <ul className="fr-activity__list">
          {entries?.map((e) => (
            <Entry key={e.id} editor={editor} e={e} now={now} />
          ))}
        </ul>
      )}
      {hasMore && (
        <div className="fr-activity__more">
          <Button size="sm" variant="ghost" loading={loading} onClick={more}>
            Show older
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Under the top bar: "Ann and Bob added 4 and changed 2 items since your last visit" with
 * "See recent changes", then — while changes are highlighted — stepping through them.
 */
function CatchUpBar({ editor }: PanelProps) {
  const summary = useCatchUp(editor, (s) => s.summary);
  const dismissed = useCatchUp(editor, (s) => s.dismissed);
  const highlight = useCatchUp(editor, (s) => s.highlight);
  const loadingChanges = useCatchUp(editor, (s) => s.loading);
  useEffect(() => loadSummary(editor), [editor]);

  if (highlight) {
    const n = highlight.items.length;
    return (
      <div className="fr-activity-bar" data-fr-interactive="" role="region" aria-label={highlight.label}>
        <span className="fr-activity-bar__icon">
          <History size={16} />
        </span>
        <div className="fr-activity-bar__text">
          <strong>{highlight.label}</strong>
          <span>{n ? `${highlight.index >= 0 ? highlight.index + 1 : '–'} of ${n} on the board` : 'None of them is on the board any more'}</span>
        </div>
        {n > 1 && (
          <>
            <IconButton icon={ChevronLeft} size={32} label="Previous change" onClick={() => step(editor, -1)} />
            <IconButton icon={ChevronRight} size={32} label="Next change" onClick={() => step(editor, 1)} />
          </>
        )}
        {highlight.source === 'catch-up' && (
          <IconButton icon={List} size={32} label="List the changes" active={editor.getDock() === PANEL_ID} onClick={() => editor.openDock(PANEL_ID)} />
        )}
        <Button size="sm" variant="secondary" onClick={() => (highlight.source === 'catch-up' ? dismiss(editor) : endHighlight(editor))}>
          Done
        </Button>
      </div>
    );
  }
  if (!summary || dismissed || totalChanges(summary) === 0) return null;
  const people = summary.people.map((p) => p.name);
  return (
    <div className="fr-activity-bar" data-fr-interactive="" role="region" aria-label="Changes since your last visit">
      <AvatarStack users={summary.people.map((p) => ({ id: p.id ?? p.name, name: p.name, color: p.color, avatarUrl: p.avatarUrl }))} max={3} size={28} />
      <div className="fr-activity-bar__text">
        <strong>
          {peopleText(people)} {countsText(summary.counts)}
        </strong>
        <span>since your last visit{summary.since ? ` (${sinceText(summary.since)})` : ''}</span>
      </div>
      <Button size="sm" variant="primary" loading={loadingChanges} onClick={() => void showChanges(editor)}>
        See recent changes
      </Button>
      {/* #126: the AI feature's written catch-up of the same changes (greyed out with why when AI is off here). */}
      {(editor.host.ai || editor.host.aiUnavailable) && (
        <Tooltip content={editor.host.aiUnavailable ?? 'A short written summary of these changes, just for you'} side="bottom">
          <span>
            <Button size="sm" variant="secondary" icon={Sparkles} disabled={!editor.host.ai} onClick={() => editor.runCommand('ai.catchUp', { since: 'visit' })}>
              Summarise
            </Button>
          </span>
        </Tooltip>
      )}
      <IconButton icon={X} size={32} label="Dismiss" onClick={() => dismiss(editor)} />
    </div>
  );
}

function Mark({ id, kind, current, zoom }: { id: string; kind: MarkKind; current: boolean; zoom: number }) {
  const editor = useEditor();
  const el = useElement(id);
  if (!el) return null;
  const b = editor.getBounds([id]);
  if (!b) return null;
  const px = 1 / zoom;
  const pad = 6 * px;
  return (
    <div
      className={`fr-activity-hl fr-activity-hl--${kind}${current ? ' is-current' : ''}`}
      style={{ left: b.x - pad, top: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, borderWidth: (current ? 3 : 2) * px, borderRadius: 8 * px }}
    />
  );
}

/** World-space marks around the highlighted items (green: added, amber: changed); the current one stands out. */
function Highlights({ editor }: PanelProps) {
  const highlight = useCatchUp(editor, (s) => s.highlight);
  const zoom = useCamera().zoom;
  if (!highlight) return null;
  const currentId = highlight.index >= 0 ? highlight.items[highlight.index]?.id : null;
  return (
    <>
      {highlight.items.map((i) => (
        <Mark key={i.id} id={i.id} kind={i.kind} current={i.id === currentId} zoom={zoom} />
      ))}
    </>
  );
}

export default [
  definePanel({ id: PANEL_ID, slot: 'dock-right', order: 55, minRole: 'viewer', Component: ActivityPanel }),
  definePanel({ id: 'activity.catch-up', slot: 'top-center', order: 30, minRole: 'viewer', Component: CatchUpBar }),
  definePanel({ id: 'activity.highlights', slot: 'world-overlay', order: 55, minRole: 'viewer', Component: Highlights }),
];

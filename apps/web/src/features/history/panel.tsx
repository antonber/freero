import { useState } from 'react';
import { Bookmark, History, Pencil, RotateCw } from 'lucide-react';
import type { BoardVersion } from '@freero/shared';
import { DockHeader, definePanel, type Editor, type PanelProps } from '@engine';
import { Button, IconButton, Spinner } from '@ui';
import { PANEL_ID, PREVIEW_ID } from './lib/ids';
import { NameField } from './lib/NameField';
import { Preview } from './lib/Preview';
import {
  formatTime,
  groupByDay,
  nameCurrentVersion,
  refreshVersions,
  renameVersion,
  useVersions,
  versionByline,
  versionTitle,
} from './lib/versions';
import './history.css';

function Row({ editor, v, list }: { editor: Editor; v: BoardVersion; list: BoardVersion[] }) {
  const [renaming, setRenaming] = useState(false);
  const byline = versionByline(v);
  if (renaming)
    return (
      <li className="fr-history__row is-editing">
        <NameField
          initial={v.name ?? ''}
          placeholder="Name this version"
          onSave={(name) => renameVersion(editor, v, name)}
          onCancel={() => setRenaming(false)}
        />
      </li>
    );
  return (
    <li className={`fr-history__row fr-history__row--${v.kind}`}>
      <button
        type="button"
        className="fr-history__open"
        onClick={() => editor.openPanel(PREVIEW_ID, { id: v.id, ids: list.map((x) => x.id) })}
      >
        <span className="fr-history__time">{formatTime(v.createdAt)}</span>
        <span className="fr-history__label">
          <span className="fr-history__name">
            {v.kind === 'named' && <Bookmark size={13} className="fr-history__mark" aria-hidden />}
            {versionTitle(v)}
          </span>
          {byline && <span className="fr-history__by">{byline}</span>}
        </span>
      </button>
      <IconButton
        className="fr-history__rename"
        icon={Pencil}
        size={32}
        label={v.kind === 'named' ? 'Rename version' : 'Name this version'}
        onClick={() => setRenaming(true)}
      />
    </li>
  );
}

function HistoryPanel({ editor }: PanelProps) {
  const { versions, loading, error } = useVersions(editor);
  const [naming, setNaming] = useState(false);
  const groups = versions ? groupByDay(versions) : [];

  return (
    <div className="fr-history">
      <DockHeader className="fr-history__head">
        <h2 className="fr-history__title">
          Version history
          <IconButton icon={RotateCw} size={32} label="Refresh" disabled={loading} onClick={() => void refreshVersions(editor)} />
        </h2>
      </DockHeader>

      <section className="fr-history__current" aria-label="Current version">
        <div className="fr-history__currenthead">
          <span className="fr-history__live" aria-hidden />
          <span>Current version</span>
        </div>
        {naming ? (
          <NameField placeholder="e.g. Before the workshop" onSave={(name) => nameCurrentVersion(editor, name)} onCancel={() => setNaming(false)} />
        ) : (
          <Button size="sm" variant="secondary" icon={Bookmark} onClick={() => setNaming(true)}>
            Name this version
          </Button>
        )}
      </section>

      {error && (
        <div className="fr-history__error" role="alert">
          {error}
          <Button size="sm" variant="ghost" onClick={() => void refreshVersions(editor)}>
            Try again
          </Button>
        </div>
      )}
      {!versions && loading && (
        <div className="fr-history__empty">
          <Spinner size={18} />
        </div>
      )}
      {versions && !versions.length && (
        <div className="fr-history__empty">
          <History size={22} aria-hidden />
          <p>No earlier versions yet. Freero keeps one about every half hour while people edit, and you can name the current version any time.</p>
        </div>
      )}
      {groups.map((g) => (
        <section key={g.label + g.items[0].id} className="fr-history__day">
          <h3 className="fr-history__dayhead">{g.label}</h3>
          <ul className="fr-history__list">
            {g.items.map((v) => (
              <Row key={v.id} editor={editor} v={v} list={versions!} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default [
  definePanel({ id: PANEL_ID, slot: 'dock-right', order: 60, minRole: 'editor', Component: HistoryPanel }),
  /** Read-only preview of one version: editor.openPanel(PREVIEW_ID, { id, ids }). */
  definePanel({ id: PREVIEW_ID, slot: 'dialog', order: 0, minRole: 'editor', Component: Preview }),
];

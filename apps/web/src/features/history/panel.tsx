import { useState } from 'react';
import { Bookmark, History, Pencil, RotateCw, Stamp } from 'lucide-react';
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
import { t } from './messages';
import './history.css';

function Row({ editor, v, list }: { editor: Editor; v: BoardVersion; list: BoardVersion[] }) {
  const [renaming, setRenaming] = useState(false);
  const byline = versionByline(v);
  if (renaming)
    return (
      <li className="fr-history__row is-editing">
        <NameField
          initial={v.name ?? ''}
          placeholder={t('nameThisVersion')}
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
            {v.kind === 'decision' && <Stamp size={13} className="fr-history__mark" aria-label={t('decision')} />}
            {versionTitle(v)}
          </span>
          {byline && <span className="fr-history__by">{byline}</span>}
        </span>
      </button>
      <IconButton
        className="fr-history__rename"
        icon={Pencil}
        size={32}
        label={v.kind === 'named' || v.kind === 'decision' ? t('renameVersion') : t('nameThisVersion')}
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
        <h2 className="fr-history__title">{t('versionHistory')}<IconButton icon={RotateCw} size={32} label={t('refresh')} disabled={loading} onClick={() => void refreshVersions(editor)} />
        </h2>
      </DockHeader>

      <section className="fr-history__current" aria-label={t('currentVersion')}>
        <div className="fr-history__currenthead">
          <span className="fr-history__live" aria-hidden />
          <span>{t('currentVersion')}</span>
        </div>
        {naming ? (
          <NameField placeholder={t('eGBeforeTheWorkshop')} onSave={(name) => nameCurrentVersion(editor, name)} onCancel={() => setNaming(false)} />
        ) : (
          <Button size="sm" variant="secondary" icon={Bookmark} onClick={() => setNaming(true)}>{t('nameThisVersion')}</Button>
        )}
      </section>

      {error && (
        <div className="fr-history__error" role="alert">
          {error}
          <Button size="sm" variant="ghost" onClick={() => void refreshVersions(editor)}>{t('tryAgain')}</Button>
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
          <p>{t('noEarlierVersionsYetFreero')}</p>
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

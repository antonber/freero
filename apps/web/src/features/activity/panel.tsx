import { Activity, RotateCw } from 'lucide-react';
import type { ActivityEntry } from '@freero/shared';
import { definePanel, type PanelProps } from '@engine';
import { Avatar, Button, IconButton, Spinner } from '@ui';
import { PANEL_ID } from './lib/ids';
import { ago, useActivity } from './lib/feed';
import './activity.css';

function Entry({ e, now }: { e: ActivityEntry; now: number }) {
  return (
    <li className="fr-activity__entry">
      <Avatar name={e.actorName} color={e.actor?.color ?? '#8a89a3'} src={e.actor?.avatarUrl ?? null} size={28} />
      <div className="fr-activity__main">
        <span className="fr-activity__text">
          <strong>{e.actorName}</strong> {e.text}
        </span>
        <time className="fr-activity__time" dateTime={new Date(e.at).toISOString()}>
          {ago(e.at, now)}
        </time>
      </div>
    </li>
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
            <Entry key={e.id} e={e} now={now} />
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

export default definePanel({ id: PANEL_ID, slot: 'dock-right', order: 55, minRole: 'viewer', Component: ActivityPanel });

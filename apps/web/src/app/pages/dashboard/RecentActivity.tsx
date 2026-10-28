// The workspace's "Recent activity" on the dashboard home: what people did on the boards you can
// open there (the server leaves out boards you can't open and hidden frames you may not see).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity } from 'lucide-react';
import type { ActivityEntry } from '@freero/shared';
import { Avatar, Button, Spinner } from '@ui';
import { api } from '../../api/client';
import { relativeTime } from '../../lib/time';

const SHOWN = 6;

export function RecentActivity({ workspaceId }: { workspaceId: string }) {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let live = true;
    setEntries(null);
    setFailed(false);
    setAll(false);
    api.workspaceActivity(workspaceId).then(
      (r) => live && setEntries(r.entries),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [workspaceId]);

  if (failed || (entries && entries.length === 0)) return null;
  const now = Date.now();
  const shown = entries ? (all ? entries : entries.slice(0, SHOWN)) : [];
  return (
    <section className="fr-dash-activity" aria-label="Recent activity">
      <h2 className="fr-dash-activity__title">
        <Activity size={16} aria-hidden /> Recent activity
      </h2>
      {entries === null ? (
        <div className="fr-dash-activity__loading">
          <Spinner size={18} />
        </div>
      ) : (
        <ul className="fr-dash-activity__list">
          {shown.map((e) => (
            <li key={e.id}>
              <button type="button" className="fr-dash-activity__entry" onClick={() => navigate(`/board/${encodeURIComponent(e.boardId)}`)}>
                <Avatar name={e.actorName} color={e.actor?.color ?? '#8a89a3'} src={e.actor?.avatarUrl ?? null} size={28} />
                <span className="fr-dash-activity__text">
                  <strong>{e.actorName}</strong> {e.text} <span className="fr-dash-activity__on">on</span>{' '}
                  <strong>{e.boardTitle || 'Untitled board'}</strong>
                </span>
                <span className="fr-dash-activity__time">{relativeTime(e.at, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {entries && entries.length > SHOWN && !all ? (
        <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
          Show more
        </Button>
      ) : null}
    </section>
  );
}

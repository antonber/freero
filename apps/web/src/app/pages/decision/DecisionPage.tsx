// /decision/:id — a decision snapshot (KAI-161): the board, or one frame of it, exactly as it was
// frozen, rendered by the real board components in a local engine session that syncs nothing.
// Whoever may open the board may open it (the server checks); "What changed" compares it with the
// board now, through the outline, as everyone sees both.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowUpRight, GitCompareArrows, Stamp, X } from 'lucide-react';
import type { DecisionChangeItem, DecisionChanges, DecisionResponse } from '@freero/shared';
import { BoardEngine } from '@engine';
import { Button, IconButton, Spinner, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { FullPageSpinner } from '../../components/FullPageSpinner';
import { features } from '../../board/features';
import { createDecisionHost, toastNotify } from '../../board/host';
import { NotFoundPage } from '../NotFoundPage';
import { t } from './messages';
import './decision.css';

const when = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function Items({ title, items, total, tone }: { title: string; items: DecisionChangeItem[]; total: number; tone: 'added' | 'removed' | 'changed' }) {
  if (!total) return null;
  return (
    <section className={`fr-decision-changes__group is-${tone}`}>
      <h3>
        {title} <span>{total}</span>
      </h3>
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <span className="fr-decision-changes__kind">{i.kind}</span>
            {tone === 'changed' && i.before !== undefined && i.before !== i.text ? (
              <span className="fr-decision-changes__text">
                <del>{i.before || '(empty)'}</del> <ins>{i.text || '(empty)'}</ins>
              </span>
            ) : (
              <span className="fr-decision-changes__text">{i.text || t('noText')}</span>
            )}
            {i.frame && <span className="fr-decision-changes__frame">{t('inFrame', { frame: i.frame })}</span>}
          </li>
        ))}
        {total > items.length && <li className="fr-decision-changes__more">{t('and')}{' '}{total - items.length}{' '}{t('more')}</li>}
      </ul>
    </section>
  );
}

function ChangesDrawer({ id, info, onClose }: { id: string; info: DecisionResponse; onClose(): void }) {
  const [changes, setChanges] = useState<DecisionChanges | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.decisionChanges(id).then(setChanges, (e: unknown) => setError(e instanceof Error ? e.message : t('couldNotCompare')));
  }, [id]);
  const d = info.decision;
  const nothing = changes && !changes.counts.added && !changes.counts.removed && !changes.counts.changed;
  return (
    <aside className="fr-decision-changes" aria-label={t('whatChangedSinceThisDecision')}>
      <header className="fr-decision-changes__head">
        <h2>{t('whatChangedSince')}</h2>
        <IconButton icon={X} label={t('close')} onClick={onClose} />
      </header>
      <div className="fr-decision-changes__body">
        <p className="fr-decision-changes__about">
          <strong>{d.title}</strong>
          <br />{t('frozenValue', { value: when.format(d.createdAt) })}{d.createdBy ? t('byName', { name: d.createdBy.name }) : ''}
          {d.frameId ? t('frameValue', { value: d.frameTitle || t('untitled') }) : ''}
        </p>
        {d.note && <blockquote className="fr-decision-changes__note">{d.note}</blockquote>}
        {error && <p role="alert">{error}</p>}
        {!changes && !error && <Spinner size={18} />}
        {changes?.frameGone && <p className="fr-decision-changes__empty">{t('thatFrameIsnTOn')}</p>}
        {nothing && !changes?.frameGone && <p className="fr-decision-changes__empty">{t('nothingChangedTheBoardStill')}</p>}
        {changes && (
          <>
            <Items title={t('added')} items={changes.added} total={changes.counts.added} tone="added" />
            <Items title={t('changed')} items={changes.changed} total={changes.counts.changed} tone="changed" />
            <Items title={t('removed')} items={changes.removed} total={changes.counts.removed} tone="removed" />
          </>
        )}
      </div>
    </aside>
  );
}

export default function DecisionPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const notify = useToast();
  const [state, setState] = useState<{ info: DecisionResponse; bytes: Uint8Array } | { error: number; message: string } | null>(null);
  const [showChanges, setShowChanges] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([api.getDecision(id), api.decisionState(id)]).then(
      ([info, bytes]) => live && setState({ info, bytes }),
      (e) => live && setState({ error: e instanceof ApiError ? e.status : 0, message: e instanceof Error ? e.message : '' }),
    );
    return () => {
      live = false;
    };
  }, [id]);

  const go = useCallback((path: string) => navigate(path), [navigate]);
  const toast = useMemo(() => toastNotify(notify), [notify]);
  const info = state && 'info' in state ? state.info : null;
  const host = useMemo(
    () =>
      user && info
        ? createDecisionHost({ id, title: info.decision.title }, { user: { id: user.id, name: user.name, color: user.color, avatarUrl: user.avatarUrl }, navigate: go, notify: toast })
        : null,
    [id, info, user, go, toast],
  );
  const location = useMemo(() => ({ search: '', key: `decision-${id}` }), [id]);
  const badge = useMemo(
    () =>
      info ? (
        <span className="fr-decision-badge">
          <span className="fr-decision-badge__what" title={info.decision.note || undefined}>
            <Stamp size={14} aria-hidden />{' '}{t('frozenValue', { value: when.format(info.decision.createdAt) })}</span>
          <Button size="sm" variant={showChanges ? 'primary' : 'secondary'} icon={GitCompareArrows} onClick={() => setShowChanges((s) => !s)}>{t('whatChanged')}</Button>
          <Link to={`/board/${encodeURIComponent(info.board.id)}`} className="fr-decision-badge__live">{t('openLiveBoard')}{' '}<ArrowUpRight size={14} aria-hidden />
          </Link>
        </span>
      ) : null,
    [info, showChanges],
  );

  if (state && 'error' in state) {
    if (state.error === 404) return <NotFoundPage />;
    return <FullPageSpinner label={state.error === 403 ? t('thisDecisionIsOnA') : t('couldNotLoadTheDecision')} />;
  }
  if (!info || !host || !state || !('bytes' in state)) return <FullPageSpinner label={t('openingTheDecision')} />;
  return (
    <>
      <BoardEngine host={host} features={features} initialState={state.bytes} topbarAccessory={badge} location={location} />
      {showChanges && <ChangesDrawer id={id} info={info} onClose={() => setShowChanges(false)} />}
    </>
  );
}

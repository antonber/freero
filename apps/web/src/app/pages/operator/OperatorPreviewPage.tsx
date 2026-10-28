// /operator/boards/:id/preview — an operator's read-only look at a reported board: its shared
// document right now (never anyone's private drafts), rendered by the real board components in a
// local engine session that syncs nothing. `?item=` / `?thread=` focus the reported item/comment.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ShieldAlert } from 'lucide-react';
import { BoardEngine } from '@engine';
import { useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { FullPageSpinner } from '../../components/FullPageSpinner';
import { features } from '../../board/features';
import { createPreviewHost, toastNotify } from '../../board/host';
import { NotFoundPage } from '../NotFoundPage';
import './operator.css';

export default function OperatorPreviewPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const notify = useToast();
  const [state, setState] = useState<{ title: string; bytes: Uint8Array } | { error: number } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([api.moderationBoard(id), api.moderationPreview(id)]).then(
      ([detail, bytes]) => live && setState({ title: detail.board.title, bytes }),
      (e) => live && setState({ error: e instanceof ApiError ? e.status : 0 }),
    );
    return () => {
      live = false;
    };
  }, [id]);

  const go = useCallback((path: string) => navigate(path), [navigate]);
  const toast = useMemo(() => toastNotify(notify), [notify]);
  const title = state && 'title' in state ? state.title : '';
  const host = useMemo(
    () => (user ? createPreviewHost({ id, title }, { user: { id: user.id, name: user.name, color: user.color, avatarUrl: user.avatarUrl }, navigate: go, notify: toast }) : null),
    [id, title, user, go, toast],
  );
  // Focus what was reported: an item (?item=) or a comment thread (?thread=), as the board's own deep links do.
  const location = useMemo(() => ({ search: `?${params.toString()}`, key: 'preview' }), [params]);
  const badge = useMemo(
    () => (
      <span className="fr-op-preview__badge">
        <ShieldAlert size={14} aria-hidden /> Read-only snapshot
        <Link to="/operator" className="fr-op-preview__back">
          <ArrowLeft size={14} aria-hidden /> Queue
        </Link>
      </span>
    ),
    [],
  );

  if (state && 'error' in state) return state.error === 404 ? <NotFoundPage /> : <FullPageSpinner label="Could not load the board" />;
  if (!state || !host) return <FullPageSpinner label="Loading the board" />;
  return <BoardEngine host={host} features={features} initialState={state.bytes} topbarAccessory={badge} location={location} />;
}

// /operator?view=public-links — boards whose link grants access right now (set, not blocked, not
// expired, not trashed or taken down), newest update first, to spot-check what Freero serves in
// public without querying the database. Preview opens the read-only snapshot (the operator never
// joins the board); the board's own link is shown to copy, not to follow, for the same reason.
// "Turn off link" goes through the console's action dialog like everywhere else: a reason, a
// statement emailed to the owner, recorded and audited. Each page read is audited on the server.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Eye, Link2Off } from 'lucide-react';
import type { LinkAccess, ModerationActionKind, PublicLinkBoard, ReportReason } from '@freero/shared';
import { Button, IconButton, Spinner, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { copyText } from '../../lib/hooks';
import { relativeTime } from '../../lib/time';
import { t as tr } from './messages';

export interface PublicLinkAct {
  action: ModerationActionKind;
  targetId: string;
  targetLabel: string;
  reason: ReportReason;
}

const ACCESS_LABEL: Record<Exclude<LinkAccess, 'none'>, string> = {
  viewer: tr('publicLinksCanView'),
  commenter: tr('publicLinksCanComment'),
  editor: tr('publicLinksCanEdit'),
};

export function PublicLinksView({ version, onAct }: { version: number; onAct: (a: PublicLinkAct) => void }) {
  const notify = useToast();
  const [boards, setBoards] = useState<PublicLinkBoard[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    (before: string | null = null) => {
      if (before) setLoadingMore(true);
      else setBoards(null);
      api.moderationPublicLinks(before).then(
        (r) => {
          setBoards((cur) => (before && cur ? [...cur, ...r.boards] : r.boards));
          setNext(r.nextBefore);
          setLoadingMore(false);
        },
        (e: unknown) => {
          notify(e instanceof ApiError ? e.message : tr('somethingWentWrongTryAgain'), 'error');
          setBoards((cur) => (before ? cur : []));
          setLoadingMore(false);
        },
      );
    },
    [notify],
  );
  useEffect(() => load(), [load, version]);

  const copy = async (url: string) => {
    const ok = await copyText(url);
    notify(ok ? tr('publicLinksCopied') : tr('somethingWentWrongTryAgain'), ok ? 'success' : 'error');
  };

  return (
    <main className="fr-op__queue" aria-label={tr('publicLinks')}>
      <p className="fr-op-links__intro">{tr('publicLinksIntro')}</p>
      {boards === null ? (
        <Spinner size={22} label={tr('loading')} />
      ) : boards.length === 0 ? (
        <p className="fr-op__empty">{tr('publicLinksNone')}</p>
      ) : (
        <>
          <div className="fr-op-links">
            <table className="fr-op-links__table">
              <thead>
                <tr>
                  <th scope="col">{tr('publicLinksBoard')}</th>
                  <th scope="col">{tr('publicLinksAccess')}</th>
                  <th scope="col">{tr('publicLinksUpdated')}</th>
                  <th scope="col">{tr('publicLinksOwner')}</th>
                  <th scope="col">{tr('publicLinksLink')}</th>
                  <th scope="col">
                    <span className="fr-op-links__sr">{tr('actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {boards.map((b) => (
                  <tr key={b.id} data-testid="public-link">
                    <td className="fr-op-links__title">{b.title || tr('untitledBoard')}</td>
                    <td>
                      <span className="fr-op-chips">
                        <span className={`fr-op-chip fr-op-chip--${b.linkAccess === 'editor' ? 'warn' : 'muted'}`}>{ACCESS_LABEL[b.linkAccess]}</span>
                        {b.passwordProtected && <span className="fr-op-chip fr-op-chip--muted">{tr('publicLinksPassword')}</span>}
                        {b.linkExpiresAt !== null && (
                          <span className="fr-op-chip fr-op-chip--muted" title={new Date(b.linkExpiresAt).toLocaleString()}>
                            {tr('publicLinksExpires', { when: new Date(b.linkExpiresAt).toLocaleDateString() })}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="fr-op-links__when" title={new Date(b.updatedAt).toLocaleString()}>
                      {relativeTime(b.updatedAt, Date.now())}
                    </td>
                    <td className="fr-op-links__owner">
                      <div>{b.owner ? b.owner.name : tr('aDeletedAccount')}</div>
                      {b.owner && <div className="fr-op-links__email">{b.owner.email}</div>}
                      <div className="fr-op-links__workspace">
                        {b.workspace ? (b.workspace.personal ? tr('publicLinksPersonalWorkspace') : b.workspace.name) : '—'}
                        {b.owner?.suspended && <span className="fr-op-chip fr-op-chip--danger">{tr('ownerSuspended')}</span>}
                      </div>
                    </td>
                    <td className="fr-op-links__url">
                      <code>{b.url}</code>
                      <IconButton icon={Copy} size={32} label={tr('publicLinksCopy')} onClick={() => void copy(b.url)} />
                    </td>
                    <td>
                      <span className="fr-op-links__actions">
                        <Link className="fr-op-btnlink" to={`/operator/boards/${encodeURIComponent(b.id)}/preview`} target="_blank" rel="noopener">
                          <Eye size={15} aria-hidden /> {tr('preview')}
                        </Link>
                        <Button
                          size="sm"
                          icon={Link2Off}
                          onClick={() => onAct({ action: 'board.disable_link', targetId: b.id, targetLabel: `“${b.title || tr('untitledBoard')}”`, reason: 'other' })}
                        >
                          {tr('turnOffLink')}
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {next ? (
            <Button variant="ghost" loading={loadingMore} onClick={() => load(next)}>
              {tr('publicLinksMore')}
            </Button>
          ) : null}
        </>
      )}
    </main>
  );
}

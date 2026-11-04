// Everyone's trash for the workspace's content admins (#153): who deleted each board and when, when
// it goes for good, and Restore (for its owner). Metadata only: opening a board still needs access.
import { useCallback, useEffect, useState } from 'react';
import { ArchiveRestore } from 'lucide-react';
import type { AdminTrashedBoard, WorkspaceSummary } from '@freero/shared';
import { Button, Spinner, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { relativeTime } from '../../lib/time';

import { t } from './messages';
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);

export function AdminTrash({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [boards, setBoards] = useState<AdminTrashedBoard[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.adminTrash(workspace.id).then(
      (r) => setBoards(r.boards),
      (e) => notify(errorText(e, t('couldNotLoadTheTrash')), 'error'),
    );
  }, [workspace.id, notify]);
  useEffect(load, [load]);

  const restore = async (b: AdminTrashedBoard) => {
    setBusy(b.boardId);
    try {
      await api.adminRestoreBoard(workspace.id, b.boardId);
      setBoards((all) => (all ?? []).filter((x) => x.boardId !== b.boardId));
      notify(t('restoredValueForOwnername', { value: b.title || t('untitledBoard'), ownerName: b.ownerName }), 'success');
    } catch (e) {
      notify(errorText(e, t('couldNotRestoreIt')), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!boards) return <Spinner />;
  return (
    <section aria-labelledby="admin-trash-title">
      <div className="fr-admin__head">
        <h1 id="admin-trash-title" className="fr-admin__title">{t('trash')}</h1>
        <span className="fr-admin__muted">{t('everyBoardDeletedInName', { name: workspace.name })}</span>
      </div>
      <div className="fr-admin-table-wrap">
        <table className="fr-admin-table">
          <thead>
            <tr>
              <th scope="col">{t('board')}</th>
              <th scope="col">{t('owner')}</th>
              <th scope="col">{t('deleted')}</th>
              <th scope="col">{t('deletedForGood')}</th>
              <th scope="col">
                <span className="fr-admin__sr">{t('actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {boards.map((b) => (
              <tr key={b.boardId}>
                <td className="fr-admin-person__name">{b.title || (b.kind === 'doc' ? t('untitledDoc') : t('untitledBoard'))}</td>
                <td>{b.ownerName}</td>
                <td className="fr-admin__muted">
                  {relativeTime(b.deletedAt)}
                  {b.deletedBy ? t('byName', { name: b.deletedBy.name }) : ''}
                </td>
                <td className="fr-admin__muted">{new Date(b.purgeAt).toLocaleDateString()}</td>
                <td className="fr-admin-table__actions">
                  <Button size="sm" icon={ArchiveRestore} loading={busy === b.boardId} onClick={() => void restore(b)}>{t('restore')}</Button>
                </td>
              </tr>
            ))}
            {boards.length === 0 ? (
              <tr>
                <td colSpan={5} className="fr-admin__muted">{t('theTrashIsEmpty')}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

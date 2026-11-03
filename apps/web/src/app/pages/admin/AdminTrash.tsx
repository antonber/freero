// Everyone's trash for the workspace's content admins (#153): who deleted each board and when, when
// it goes for good, and Restore (for its owner). Metadata only: opening a board still needs access.
import { useCallback, useEffect, useState } from 'react';
import { ArchiveRestore } from 'lucide-react';
import type { AdminTrashedBoard, WorkspaceSummary } from '@freero/shared';
import { Button, Spinner, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { relativeTime } from '../../lib/time';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);

export function AdminTrash({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [boards, setBoards] = useState<AdminTrashedBoard[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.adminTrash(workspace.id).then(
      (r) => setBoards(r.boards),
      (e) => notify(errorText(e, 'Could not load the trash'), 'error'),
    );
  }, [workspace.id, notify]);
  useEffect(load, [load]);

  const restore = async (b: AdminTrashedBoard) => {
    setBusy(b.boardId);
    try {
      await api.adminRestoreBoard(workspace.id, b.boardId);
      setBoards((all) => (all ?? []).filter((x) => x.boardId !== b.boardId));
      notify(`Restored “${b.title || 'Untitled board'}” for ${b.ownerName}`, 'success');
    } catch (e) {
      notify(errorText(e, 'Could not restore it'), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!boards) return <Spinner />;
  return (
    <section aria-labelledby="admin-trash-title">
      <div className="fr-admin__head">
        <h1 id="admin-trash-title" className="fr-admin__title">
          Trash
        </h1>
        <span className="fr-admin__muted">
          Every board deleted in {workspace.name}, whoever deleted it. Restoring gives it back to its owner, where it was.
        </span>
      </div>
      <div className="fr-admin-table-wrap">
        <table className="fr-admin-table">
          <thead>
            <tr>
              <th scope="col">Board</th>
              <th scope="col">Owner</th>
              <th scope="col">Deleted</th>
              <th scope="col">Deleted for good</th>
              <th scope="col">
                <span className="fr-admin__sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {boards.map((b) => (
              <tr key={b.boardId}>
                <td className="fr-admin-person__name">{b.title || (b.kind === 'doc' ? 'Untitled doc' : 'Untitled board')}</td>
                <td>{b.ownerName}</td>
                <td className="fr-admin__muted">
                  {relativeTime(b.deletedAt)}
                  {b.deletedBy ? ` by ${b.deletedBy.name}` : ''}
                </td>
                <td className="fr-admin__muted">{new Date(b.purgeAt).toLocaleDateString()}</td>
                <td className="fr-admin-table__actions">
                  <Button size="sm" icon={ArchiveRestore} loading={busy === b.boardId} onClick={() => void restore(b)}>
                    Restore
                  </Button>
                </td>
              </tr>
            ))}
            {boards.length === 0 ? (
              <tr>
                <td colSpan={5} className="fr-admin__muted">
                  The trash is empty.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

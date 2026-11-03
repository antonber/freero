// Where a board goes (#124): the workspace and project of a duplicate, or another workspace (and
// project there) to move a board into. Only workspaces where you may create boards are offered; the
// server checks the same and, for a move, applies the target's policies — what it turned off is
// shown when the move is done.
import { useEffect, useState } from 'react';
import { Copy, FolderInput } from 'lucide-react';
import type { BoardSummary, MoveAdjustment, ProjectSummary, WorkspaceSummary } from '@freero/shared';
import { Button, Modal, Select } from '@ui';
import { api, ApiError } from '../../api/client';
import { workspaceLabel } from './useWorkspaces';

const NO_PROJECT = '';

/** What a move turned off, in words for the toast (empty: nothing). */
export function adjustmentText(adjusted: MoveAdjustment[]): string {
  const parts = adjusted.map((a) =>
    a.kind === 'link_off'
      ? 'its link was turned off'
      : a.kind === 'link_lowered'
        ? `its link now only lets people ${a.to === 'viewer' ? 'view' : 'comment'}`
        : a.kind === 'embedding_off'
          ? 'embedding on other sites was turned off'
          : `${a.count} linked ${a.count === 1 ? 'issue stopped' : 'issues stopped'} syncing`,
  );
  return parts.length ? ` The new workspace’s policies apply: ${parts.join(', ')}.` : '';
}

export function BoardPlaceDialog({
  mode,
  board,
  workspaces,
  onClose,
  onDone,
}: {
  mode: 'duplicate' | 'move';
  board: BoardSummary;
  workspaces: WorkspaceSummary[];
  onClose(): void;
  /** The copy (duplicate) or the moved board, and what to tell the person. */
  onDone(board: BoardSummary, note: string): void;
}) {
  // Where you may create boards; a move goes somewhere else than where the board is.
  const targets = workspaces.filter((w) => w.role !== 'guest' && !w.blocked && (mode === 'duplicate' || w.id !== board.workspaceId));
  const [ws, setWs] = useState(targets.some((w) => w.id === board.workspaceId) ? board.workspaceId : (targets[0]?.id ?? ''));
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState(mode === 'duplicate' && board.projectId ? board.projectId : NO_PROJECT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ws) return;
    let live = true;
    api.listProjects(ws).then(
      (r) => {
        if (!live) return;
        setProjects(r.projects);
        setProject((p) => (r.projects.some((x) => x.id === p) ? p : NO_PROJECT));
      },
      () => live && setProjects([]),
    );
    return () => {
      live = false;
    };
  }, [ws]);

  const title = board.title || 'Untitled board';
  const go = async () => {
    if (!ws) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'duplicate') {
        const { board: copy } = await api.duplicateBoard(board.id, { workspaceId: ws, projectId: project || null });
        onDone(copy, `Duplicated “${title}”`);
      } else {
        const { board: moved, adjusted } = await api.moveBoard(board.id, { workspaceId: ws, projectId: project || null });
        const name = workspaceLabel(targets.find((w) => w.id === ws)!);
        onDone(moved, `Moved “${title}” to ${name}.${adjustmentText(adjusted)}`);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : mode === 'duplicate' ? 'Could not duplicate the board' : 'Could not move the board');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onClose}
      title={mode === 'duplicate' ? `Duplicate “${title}”` : `Move “${title}” to another workspace`}
      description={
        mode === 'duplicate'
          ? 'The copy is yours, with the board’s content as it is now. Its sharing starts private.'
          : 'It keeps its link, comments, files and history. People who had access through its current workspace lose it; people invited to the board keep their access as the new workspace allows.'
      }
      width={520}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon={mode === 'duplicate' ? Copy : FolderInput} loading={busy} disabled={!ws} onClick={() => void go()}>
            {mode === 'duplicate' ? 'Duplicate' : 'Move board'}
          </Button>
        </>
      }
    >
      <div className="fr-dash-restore">
        {targets.length ? (
          <div className="fr-dash-restore__place">
            <label>
              <span>Workspace</span>
              <Select<string> aria-label="Workspace" options={targets.map((w) => ({ value: w.id, label: workspaceLabel(w) }))} value={ws} onChange={setWs} />
            </label>
            <label>
              <span>Project</span>
              <Select<string>
                aria-label="Project"
                options={[{ value: NO_PROJECT, label: 'No project' }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
                value={project}
                onChange={setProject}
              />
            </label>
          </div>
        ) : (
          <p className="fr-dash-restore__error">{mode === 'duplicate' ? 'You can’t create boards in any of your workspaces.' : 'You’re not a member of another workspace where you can create boards.'}</p>
        )}
        {error ? (
          <p className="fr-dash-restore__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

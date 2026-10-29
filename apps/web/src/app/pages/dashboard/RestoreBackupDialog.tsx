// Restoring a `.freero` board backup (KAI-137) as a new board: pick the file (or it was dropped on a
// board / opened with the installed app), choose the workspace and project, and the server makes
// the board — files re-uploaded under your quota, every item with a fresh id.
import { useEffect, useState } from 'react';
import { ArchiveRestore } from 'lucide-react';
import type { ProjectSummary, WorkspaceSummary } from '@freero/shared';
import { BACKUP_EXTENSION } from '@freero/shared';
import { Button, Modal, Select } from '@ui';
import { api, ApiError } from '../../api/client';
import { workspaceLabel } from './useWorkspaces';

const NO_PROJECT = '';

export function RestoreBackupDialog({
  open,
  initialFile,
  workspaces,
  workspaceId,
  projectId,
  onClose,
  onRestored,
}: {
  open: boolean;
  initialFile: File | null;
  workspaces: WorkspaceSummary[];
  workspaceId: string | null;
  projectId: string | null;
  onClose(): void;
  onRestored(boardId: string, note: string): void;
}) {
  // Only workspaces where you may create boards.
  const targets = workspaces.filter((w) => w.role !== 'guest' && !w.blocked);
  const [file, setFile] = useState<File | null>(initialFile);
  const [ws, setWs] = useState(workspaceId && targets.some((w) => w.id === workspaceId) ? workspaceId : (targets[0]?.id ?? ''));
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState(projectId ?? NO_PROJECT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setFile(initialFile), [initialFile]);

  useEffect(() => {
    if (!open || !ws) return;
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
  }, [open, ws]);

  const pick = (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(BACKUP_EXTENSION)) return setError('Choose a Freero board backup (a .freero file).');
    setFile(f);
  };

  const restore = async () => {
    if (!file || !ws) return;
    setBusy(true);
    setError(null);
    try {
      const { board, report } = await api.restoreBackup(file, { workspaceId: ws, projectId: project || null });
      const notes = [
        report.files ? `${report.files} ${report.files === 1 ? 'file' : 'files'} restored` : null,
        report.missingFiles ? `${report.missingFiles} ${report.missingFiles === 1 ? 'file wasn’t' : 'files weren’t'} in the backup` : null,
      ].filter(Boolean);
      onRestored(board.id, `Restored “${board.title}”${notes.length ? ` · ${notes.join(' · ')}` : ''}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not restore that backup');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Restore a board backup"
      description="A .freero file becomes a new board here, with its comments, tables and images. The board it came from is not changed."
      width={520}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" icon={ArchiveRestore} loading={busy} disabled={!file || !ws} onClick={() => void restore()}>
            Restore board
          </Button>
        </>
      }
    >
      <div className="fr-dash-restore">
        <label className="fr-dash-restore__file">
          <ArchiveRestore size={18} aria-hidden />
          <span>{file ? file.name : 'Choose a .freero file'}</span>
          <input type="file" accept={`${BACKUP_EXTENSION},application/vnd.freero.board+zip`} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
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
          <p className="fr-dash-restore__error">You can’t create boards in any of your workspaces.</p>
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

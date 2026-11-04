// A project's landing page (#129), above its boards: where it sits, what it is for, its
// sub-projects, the boards its managers pinned, and recent activity on its boards. Managers edit
// the description in the project's settings and choose the pinned boards here.
import { useState } from 'react';
import { ChevronRight, Folder, FolderLock, Pin, PinOff, Settings2 } from 'lucide-react';
import { PROJECT_MAX_PINNED_BOARDS, type BoardSummary, type ProjectSummary } from '@freero/shared';
import { Button, Modal, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { objectHref } from '../../lib/boards';
import { BoardThumb } from './BoardThumb';
import { projectPath, subProjects } from './projectTree';
import { RecentActivity } from './RecentActivity';

export function ProjectOverview({
  project,
  projects,
  boards,
  onOpenProject,
  onEdit,
  onChanged,
}: {
  project: ProjectSummary;
  projects: ProjectSummary[];
  /** The project's boards as the list loaded them (null while loading). */
  boards: BoardSummary[] | null;
  onOpenProject: (id: string) => void;
  onEdit: () => void;
  onChanged: (p: ProjectSummary) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const path = projectPath(project.id, projects);
  const subs = subProjects(project.id, projects);
  const byId = new Map((boards ?? []).map((b) => [b.id, b]));
  // Pinned boards still in the project and visible to you, in the order they were pinned.
  const pinned = (project.pinnedBoardIds ?? []).map((id) => byId.get(id)).filter((b): b is BoardSummary => !!b);
  const empty = !project.description && subs.length === 0 && pinned.length === 0 && !project.canManage;

  return (
    <section className="fr-dash-projpage" aria-label="About this project">
      {path.length > 1 ? (
        <nav className="fr-dash-projpage__path" aria-label="Project path">
          {path.slice(0, -1).map((p) => (
            <span key={p.id} className="fr-dash-projpage__crumb">
              <button type="button" onClick={() => onOpenProject(p.id)}>
                {p.name}
              </button>
              <ChevronRight size={14} aria-hidden />
            </span>
          ))}
          <span aria-current="page">{project.name}</span>
        </nav>
      ) : null}
      <h1 className="fr-dash-projpage__name">
        {project.name}
        {project.access === 'private' ? <span className="fr-dash-proj__private">Private</span> : null}
      </h1>
      {empty ? null : (
        <div className="fr-dash-projpage__about">
          {project.description ? (
            <p className="fr-dash-projpage__desc">{project.description}</p>
          ) : project.canManage ? (
            <p className="fr-dash-projpage__desc fr-dash-projpage__desc--empty">Say what this project is for, so people know what they’ll find here.</p>
          ) : null}
          {project.canManage ? (
            <div className="fr-dash-projpage__tools">
              <Button size="sm" variant="ghost" icon={Settings2} onClick={onEdit}>
                Edit description
              </Button>
              <Button size="sm" variant="ghost" icon={Pin} onClick={() => setChoosing(true)} disabled={!boards || boards.length === 0}>
                Pin boards
              </Button>
            </div>
          ) : null}
        </div>
      )}
      {subs.length ? (
        <div className="fr-dash-projpage__block">
          <h2 className="fr-dash-projpage__title">Sub-projects</h2>
          <ul className="fr-dash-projpage__subs">
            {subs.map((s) => {
              const Icon = s.access === 'private' ? FolderLock : Folder;
              return (
                <li key={s.id}>
                  <button type="button" className="fr-dash-projpage__sub" onClick={() => onOpenProject(s.id)}>
                    <Icon size={16} aria-hidden />
                    <span>{s.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {pinned.length ? (
        <div className="fr-dash-projpage__block">
          <h2 className="fr-dash-projpage__title">
            <Pin size={14} aria-hidden /> Pinned
          </h2>
          <ul className="fr-dash-projpage__pinned">
            {pinned.map((b) => (
              <li key={b.id}>
                <a className="fr-dash-projpage__pin" href={objectHref(b)}>
                  <BoardThumb board={b} />
                  <span className="fr-dash-projpage__pin-name">{b.title || 'Untitled board'}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <RecentActivity workspaceId={project.workspaceId} projectId={project.id} />
      {choosing && boards ? <PinBoardsDialog project={project} boards={boards} onClose={() => setChoosing(false)} onSaved={onChanged} /> : null}
    </section>
  );
}

function PinBoardsDialog({ project, boards, onClose, onSaved }: { project: ProjectSummary; boards: BoardSummary[]; onClose: () => void; onSaved: (p: ProjectSummary) => void }) {
  const notify = useToast();
  const inProject = boards.filter((b) => b.projectId === project.id);
  const [ids, setIds] = useState<string[]>(() => (project.pinnedBoardIds ?? []).filter((id) => inProject.some((b) => b.id === id)));
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setIds((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length >= PROJECT_MAX_PINNED_BOARDS ? list : [...list, id]));
  const save = async () => {
    setBusy(true);
    try {
      onSaved((await api.updateProject(project.id, { pinnedBoardIds: ids })).project);
      onClose();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Could not pin the boards', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Pin boards on this project’s page"
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <p className="fr-dash-projpage__hint">Everyone who opens the project sees these first (up to {PROJECT_MAX_PINNED_BOARDS}).</p>
      <ul className="fr-dash-projpage__choose">
        {inProject.map((b) => {
          const on = ids.includes(b.id);
          return (
            <li key={b.id}>
              <button type="button" className={`fr-dash-projpage__choice${on ? ' fr-dash-projpage__choice--on' : ''}`} aria-pressed={on} onClick={() => toggle(b.id)}>
                {on ? <Pin size={15} aria-hidden /> : <PinOff size={15} aria-hidden />}
                <span>{b.title || 'Untitled board'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

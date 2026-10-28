// The dashboard's current workspace: the `ws` URL parameter, else the one used last on this browser,
// else the personal workspace. Every board request carries it (the server scopes lists to it).
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectSummary, WorkspaceSummary } from '@freero/shared';
import { api } from '../../api/client';

const LAST_KEY = 'fr.dashboard.workspace';

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

function writeLast(id: string): void {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    // storage unavailable
  }
}

export interface WorkspacesState {
  workspaces: WorkspaceSummary[] | null;
  /** The current workspace (null while loading). */
  current: WorkspaceSummary | null;
  projects: ProjectSummary[];
  reload(): Promise<void>;
  reloadProjects(): Promise<void>;
}

/** `wanted`: the workspace named in the URL, if any. */
export function useWorkspaces(wanted: string | null): WorkspacesState {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);

  const reload = useCallback(async () => {
    try {
      setWorkspaces((await api.listWorkspaces()).workspaces);
    } catch {
      setWorkspaces((w) => w ?? []);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const current = useMemo(() => {
    if (!workspaces || workspaces.length === 0) return null;
    const id = wanted ?? readLast();
    return workspaces.find((w) => w.id === id) ?? workspaces.find((w) => w.kind === 'personal') ?? workspaces[0];
  }, [workspaces, wanted]);

  useEffect(() => {
    if (current) writeLast(current.id);
  }, [current]);

  const currentId = current?.id ?? null;
  const reloadProjects = useCallback(async () => {
    if (!currentId) return;
    try {
      const { projects } = await api.listProjects(currentId);
      setProjects(projects);
    } catch {
      setProjects([]);
    }
  }, [currentId]);

  useEffect(() => {
    setProjects([]);
    void reloadProjects();
  }, [reloadProjects]);

  return { workspaces, current, projects, reload, reloadProjects };
}

/** How a workspace is named in the app. */
export function workspaceLabel(w: WorkspaceSummary): string {
  return w.kind === 'personal' ? 'Personal' : w.name;
}

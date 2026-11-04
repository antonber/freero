// Nested projects (#129) as the dashboard shows them: the sidebar's tree, the places a project may
// move to, its sub-projects. The server decides what is allowed; this only keeps the UI from
// offering moves it would refuse (into itself, below itself, deeper than PROJECT_MAX_DEPTH).
import { PROJECT_MAX_DEPTH, type ProjectSummary } from '@freero/shared';

const parentOf = (p: ProjectSummary) => p.parentId ?? null;

/** Projects in tree order (each followed by its sub-projects), with their depth (0: the top). A project whose parent you can't see sits at the top. */
export function projectTree(projects: ProjectSummary[]): Array<{ project: ProjectSummary; depth: number }> {
  const ids = new Set(projects.map((p) => p.id));
  const children = new Map<string | null, ProjectSummary[]>();
  for (const p of projects) {
    const parent = parentOf(p) && ids.has(parentOf(p)!) ? parentOf(p) : null;
    children.set(parent, [...(children.get(parent) ?? []), p]);
  }
  const out: Array<{ project: ProjectSummary; depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    for (const p of children.get(parent) ?? []) {
      if (out.some((o) => o.project.id === p.id)) continue;
      out.push({ project: p, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** The project's own sub-projects. */
export const subProjects = (id: string, projects: ProjectSummary[]) => projects.filter((p) => parentOf(p) === id);

/** The project and the chain above it, top first (for a breadcrumb). */
export function projectPath(id: string, projects: ProjectSummary[]): ProjectSummary[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const out: ProjectSummary[] = [];
  for (let p = byId.get(id); p && out.length <= PROJECT_MAX_DEPTH; p = parentOf(p) ? byId.get(parentOf(p)!) : undefined) out.unshift(p);
  return out;
}

function below(id: string, projects: ProjectSummary[]): Set<string> {
  const out = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of projects) if (parentOf(p) && out.has(parentOf(p)!) && !out.has(p.id)) (out.add(p.id), (grew = true));
  }
  return out;
}

function height(id: string, projects: ProjectSummary[], guard = 0): number {
  if (guard > PROJECT_MAX_DEPTH) return 1;
  return 1 + Math.max(0, ...subProjects(id, projects).map((c) => height(c.id, projects, guard + 1)));
}

/**
 * Where `project` (null: a new one) may go: projects it isn't already above, with room for it and
 * the sub-projects it carries.
 */
export function placesFor(project: ProjectSummary | null, projects: ProjectSummary[]): ProjectSummary[] {
  const excluded = project ? below(project.id, projects) : new Set<string>();
  const need = project ? height(project.id, projects) : 1;
  return projects.filter((p) => !excluded.has(p.id) && projectPath(p.id, projects).length + need <= PROJECT_MAX_DEPTH);
}

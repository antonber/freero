-- Owned by modules/workspaces. #129: projects nest (a parent project, at most MAX_PROJECT_DEPTH
-- levels), carry a description and the boards their managers pin on the project page, and people
-- pin projects to the top of their own sidebar.
--
-- parent_id has no ON DELETE action on purpose: a project with sub-projects is never deleted
-- (projects.ts refuses), and deleting a workspace removes all of its projects in one statement,
-- which the end-of-statement check allows. A cascade or SET NULL here could silently lift a
-- sub-project to the top, opening its boards wider than its parent allowed.
ALTER TABLE projects ADD COLUMN parent_id text REFERENCES projects (id);
ALTER TABLE projects ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN pinned_boards text[] NOT NULL DEFAULT '{}';
CREATE INDEX projects_parent_id ON projects (parent_id) WHERE parent_id IS NOT NULL;

-- A person's pinned projects (per person; shown first in their sidebar).
CREATE TABLE project_pins (
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  pinned_at  timestamptz NOT NULL,
  PRIMARY KEY (user_id, project_id)
);
CREATE INDEX project_pins_project ON project_pins (project_id);

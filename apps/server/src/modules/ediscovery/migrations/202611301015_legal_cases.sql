-- Owned by modules/ediscovery (#157; docs/design/compliance.md §1). Only ediscovery/repo.ts writes
-- these tables. The hold itself (what can't be deleted) is kept by modules/boards, keyed by the
-- case id; these rows are the case: what it names (kept after release, for the record), which
-- workspaces it covers, and its exports. No foreign key to the place: like the audit log, a case's
-- record outlives the workspace it was opened in.
CREATE TABLE legal_cases (
  id          text PRIMARY KEY,
  place_id    text NOT NULL,          -- the team workspace or organisation that opened it
  place_kind  text NOT NULL CHECK (place_kind IN ('team', 'organisation')),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_by  text,
  created_at  timestamptz NOT NULL,
  released_at timestamptz,
  released_by text
);
CREATE INDEX legal_cases_place ON legal_cases (place_id, created_at);
CREATE INDEX legal_cases_open ON legal_cases (place_id) WHERE released_at IS NULL;

-- The workspaces a case covers: its own, or the organisation's attached workspaces when placed.
CREATE TABLE legal_case_workspaces (
  case_id      text NOT NULL REFERENCES legal_cases (id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  PRIMARY KEY (case_id, workspace_id)
);
CREATE INDEX legal_case_workspaces_workspace ON legal_case_workspaces (workspace_id);

-- What the case names: custodians (people) and boards.
CREATE TABLE legal_case_subjects (
  case_id    text NOT NULL REFERENCES legal_cases (id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('custodian', 'board')),
  subject_id text NOT NULL,
  added_at   timestamptz NOT NULL,
  PRIMARY KEY (case_id, kind, subject_id)
);
CREATE INDEX legal_case_subjects_custodian ON legal_case_subjects (subject_id) WHERE kind = 'custodian';

-- A case's exports: built in the background into uploads' private files, downloadable by whoever
-- manages the case until expires_at, then deleted.
CREATE TABLE legal_case_exports (
  id           text PRIMARY KEY,
  case_id      text NOT NULL REFERENCES legal_cases (id) ON DELETE CASCADE,
  requested_by text,
  status       text NOT NULL CHECK (status IN ('pending', 'running', 'ready', 'failed', 'expired')),
  attempts     integer NOT NULL DEFAULT 0,
  file_key     text,
  bytes        bigint,
  error        text,
  created_at   timestamptz NOT NULL,
  started_at   timestamptz,
  ready_at     timestamptz,
  expires_at   timestamptz
);
CREATE INDEX legal_case_exports_case ON legal_case_exports (case_id, created_at);
CREATE INDEX legal_case_exports_status ON legal_case_exports (status, created_at);

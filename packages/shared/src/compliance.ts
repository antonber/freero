// Legal holds and eDiscovery cases (#157) and classification labels (#158); docs/design/compliance.md.
import type { ObjectKind, WorkspacePolicies } from './api';

// ---- legal holds (#157) ----
// Owners, and admins with both the security and content scopes, of a team workspace or an organisation:
// GET    /api/workspaces/:id/legal-cases                 -> { cases: LegalCaseSummary[] }
// POST   /api/workspaces/:id/legal-cases                 LegalCaseInput -> { case: LegalCaseDetail }
// GET    /api/workspaces/:id/legal-cases/:caseId         -> { case: LegalCaseDetail }
// PATCH  /api/workspaces/:id/legal-cases/:caseId         LegalCaseChange -> { case }
// POST   /api/workspaces/:id/legal-cases/:caseId/release -> { case }
// POST   /api/workspaces/:id/legal-cases/:caseId/exports -> { export: LegalCaseExportInfo }
// GET    /api/workspaces/:id/legal-cases/:caseId/exports/:exportId/download -> the ZIP

export interface LegalCaseCustodian {
  userId: string;
  name: string;
  email: string | null;
}

export interface LegalCaseSummary {
  id: string;
  /** The team workspace or organisation the case belongs to. */
  placeId: string;
  name: string;
  description: string;
  createdAt: number;
  createdBy: { id: string; name: string } | null;
  releasedAt: number | null;
  releasedBy: { id: string; name: string } | null;
  custodians: LegalCaseCustodian[];
  /** Boards the case names explicitly (custodians' boards come on top). */
  boardIds: string[];
  /** Boards the hold keeps right now (0 once released). */
  heldBoards: number;
}

export type HeldBoardState = 'live' | 'archived' | 'trashed' | 'deleted' | 'taken_down';

export interface LegalCaseBoard {
  id: string;
  kind: ObjectKind;
  title: string;
  ownerName: string;
  workspaceId: string;
  workspaceName: string;
  /** 'deleted': its owner deleted it forever while held — hidden from everyone, kept for the case. */
  state: HeldBoardState;
  /** Named by the case itself (else it is held as a custodian's). */
  named: boolean;
}

export interface LegalCaseExportInfo {
  id: string;
  status: 'pending' | 'running' | 'ready' | 'failed' | 'expired';
  createdAt: number;
  readyAt: number | null;
  expiresAt: number | null;
  bytes: number | null;
  requestedBy: { id: string; name: string } | null;
}

export interface LegalCaseDetail extends LegalCaseSummary {
  boards: LegalCaseBoard[];
  /** For an organisation's case: the attached workspaces it covers. */
  workspaces: Array<{ id: string; name: string }>;
  exports: LegalCaseExportInfo[];
}

export interface LegalCaseInput {
  name: string;
  description?: string;
  /** People whose boards in the case's workspaces are held, now and later. */
  custodianIds?: string[];
  boardIds?: string[];
}

export interface LegalCaseChange {
  name?: string;
  description?: string;
  addCustodianIds?: string[];
  removeCustodianIds?: string[];
  addBoardIds?: string[];
  removeBoardIds?: string[];
  /** An organisation's case: cover the workspaces attached since it was placed. */
  refreshWorkspaces?: boolean;
}

// ---- classification labels (#158) ----

/** The policies a label can cap (the floored ones; numeric `linkMaxDays` too). */
export const LABEL_CAP_KEYS = ['linkSharing', 'publicLinks', 'externalSharing', 'downloads', 'boardEmbeds', 'liveEmbeds', 'linkPassword', 'linkMaxDays', 'offlineCopies'] as const;
export type LabelCapKey = (typeof LABEL_CAP_KEYS)[number];

/**
 * The most a board carrying the label may allow, whatever its workspace allows: each key present is a
 * floor (the stricter of it and the workspace's effective policy applies). `viewerExports: 'off'`:
 * viewers and commenters may never copy or export, whatever the board's own switch says.
 */
export type LabelCaps = Partial<Pick<WorkspacePolicies, LabelCapKey>> & { viewerExports?: 'off' };

// Labels of a team workspace or an organisation (owners and content admins edit; members list):
// GET    /api/workspaces/:id/labels                -> { labels: BoardLabel[], required: boolean, defaultLabelId: string | null }
// POST   /api/workspaces/:id/labels                BoardLabelInput -> { label }
// PATCH  /api/workspaces/:id/labels/:labelId       Partial<BoardLabelInput> -> { label }
// DELETE /api/workspaces/:id/labels/:labelId       (409 label_in_use while boards carry it)
// PUT    /api/boards/:id/label                     { labelId: string | null } -> { board: BoardSummary }
export interface BoardLabel {
  id: string;
  /** Where it is defined: the workspace, or its organisation (then `inherited` for a workspace's list). */
  placeId: string;
  inherited: boolean;
  name: string;
  /** #rrggbb */
  color: string;
  description: string;
  caps: LabelCaps;
  /** How many boards carry it (in the place that lists it). */
  boards?: number;
}

export interface BoardLabelInput {
  name: string;
  color?: string;
  description?: string;
  caps?: LabelCaps;
}

/** What a board summary says about its label. */
export interface BoardLabelSummary {
  id: string;
  name: string;
  color: string;
  caps: LabelCaps;
}

// ---- the sensitive-data scan (#158; docs/design/compliance.md §2) ----
// A team workspace may scan what its boards say (the shared content, as every reader sees it) for
// sensitive data. A finding records the board, the item and the kind, and how many — never the
// text that matched. Content admins (and owners) set it up and see the findings:
// GET  /api/workspaces/:id/admin/sensitive-data            -> SensitiveDataStatus
// PUT  /api/workspaces/:id/admin/sensitive-data            SensitiveDataSettingsInput -> SensitiveDataStatus
// The board's own people who manage its label (owner, co-owners, content admins):
// GET  /api/boards/:id/sensitive-data                      -> BoardSensitiveData
export const SENSITIVE_DATA_KINDS = ['payment_card', 'iban', 'national_id', 'secret', 'email', 'phone'] as const;
export type SensitiveDataKind = (typeof SENSITIVE_DATA_KINDS)[number];
/** What a workspace scans for when it turns the scan on without choosing (email and phone are opt-in). */
export const DEFAULT_SENSITIVE_DATA_KINDS: readonly SensitiveDataKind[] = ['payment_card', 'iban', 'national_id', 'secret'];

/**
 * notify: admins are told and the console lists it; suggest: also the board's managers see the
 * label to give it; require: the label is given by Freero, and while the board holds findings its
 * label can only be changed to one at least as strict.
 */
export type SensitiveDataAction = 'notify' | 'suggest' | 'require';

export interface SensitiveDataSettings {
  enabled: boolean;
  kinds: SensitiveDataKind[];
  action: SensitiveDataAction;
  /** The label to suggest or require (null: none, only notify). */
  labelId: string | null;
}
export type SensitiveDataSettingsInput = Partial<SensitiveDataSettings>;

export interface SensitiveDataFinding {
  boardId: string;
  boardTitle: string;
  /** The item it is in (null: the board's title or a comment not pinned to an item). */
  elementId: string | null;
  /** Where on the board: an item, a comment, the board itself. */
  where: 'item' | 'comment' | 'board';
  kind: SensitiveDataKind;
  count: number;
  foundAt: number;
}

export interface SensitiveDataStatus {
  settings: SensitiveDataSettings;
  /** Newest first, at most 500. */
  findings: SensitiveDataFinding[];
}

export interface BoardSensitiveData {
  /** Kinds found on the board now (empty: nothing found, or the scan is off). */
  kinds: SensitiveDataKind[];
  action: SensitiveDataAction | null;
  /** The label the workspace suggests or requires for it, unless the board's label already satisfies it. */
  label: BoardLabelSummary | null;
}

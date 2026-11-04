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
export const LABEL_CAP_KEYS = ['linkSharing', 'publicLinks', 'externalSharing', 'downloads', 'boardEmbeds', 'liveEmbeds', 'linkPassword', 'linkMaxDays'] as const;
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

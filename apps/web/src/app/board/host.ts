// Builds the engine's Host — the one typed contract between the app shell and the engine.
import type { BoardSummary, Role } from '@freero/shared';
import { unavailableVersionHistory, type Host, type HostUser } from '@engine';
import type { ToastApi } from '@ui';
import { api, wsBase } from '../api/client';
import {
  deleteTemplate,
  fetchImage,
  importImage,
  inviteMember,
  listMembers,
  lookupUsers,
  listTemplates,
  loadTemplate,
  renameBoard,
  reportOn,
  saveTemplateFrom,
  saveThumbnail,
  reportExport,
  shareTemplateWith,
  unfurl,
  uploadFile,
  uploadImage,
  versionHistory,
} from '../hostServices';
import { serverNow, syncServerClock } from './serverClock';

export interface HostDeps {
  user: HostUser;
  navigate(path: string): void;
  notify: Host['notify'];
  openShareDialog(): void;
  onTitleChange(title: string): void;
  /** The board's team workspace, when the user is a full member of it (templates can be shared there). */
  team?: { id: string; name: string } | null;
}

/** Toasts with an action button stay up long enough to read and act on. */
const ACTION_TOAST_MS = 12000;

/** Host.notify on top of the UI kit's toasts (`useToast()`). */
export function toastNotify(toast: ToastApi): Host['notify'] {
  return (message, kind, opts) => {
    const action = opts?.action;
    if (!action) return toast(message, kind);
    toast(message, kind, { duration: ACTION_TOAST_MS, action: { label: action.label, onClick: () => action.run() } });
  };
}

export function createServerHost(board: BoardSummary, deps: HostDeps): Host {
  syncServerClock();
  return {
    user: deps.user,
    board: {
      id: board.id,
      title: board.title,
      role: board.role,
      canExport: board.permissions.canExport,
      team: deps.team ? { name: deps.team.name } : null,
    },
    syncUrl: `${wsBase()}/ws/boards`,
    uploadImage,
    uploadFile,
    async renameBoard(title) {
      await renameBoard(board.id, title);
      deps.onTitleChange(title);
    },
    saveThumbnail: (dataUrl) => saveThumbnail(board.id, dataUrl),
    reportExport: (format) => reportExport(board.id, format),
    openShareDialog: deps.openShareDialog,
    navigate: deps.navigate,
    notify: deps.notify,
    serverNow,
    listMembers: () => listMembers(board.id),
    lookupUsers: (ids) => lookupUsers(board.id, ids),
    inviteMember: (email, role) => inviteMember(board.id, email, role),
    unfurl,
    listTemplates,
    loadTemplate,
    saveTemplate: saveTemplateFrom(board.id, deps.team?.id ?? null),
    shareTemplate: shareTemplateWith(deps.team?.id ?? null),
    deleteTemplate,
    versions: versionHistory(board.id),
    activity: { list: (before) => api.boardActivity(board.id, before) },
    importImage,
    fetchImage,
    report: reportOn(board.id),
  };
}

/**
 * A guest's Host (a visitor without an account, on the one board they joined): the board's own
 * services that work for guests (its socket, the people lookup, server time) — everything tied to
 * an account (uploads, templates, history, sharing, link previews) politely refuses instead of
 * asking the server.
 */
export function createGuestHost(
  board: BoardSummary,
  deps: { user: HostUser; navigate(path: string): void; notify: Host['notify']; signUpPath: string },
): Host {
  syncServerClock();
  const needsAccount = (what: string) => () => Promise.reject(new Error(`${what} needs a free Freero account.`));
  const signUp = () =>
    deps.notify('Sign up free to share boards, save templates and keep your work.', 'info', {
      action: { label: 'Sign up', run: () => deps.navigate(deps.signUpPath) },
    });
  return {
    user: deps.user,
    board: { id: board.id, title: board.title, role: board.role, canExport: board.permissions.canExport, team: null, signedIn: false },
    syncUrl: `${wsBase()}/ws/boards`,
    // Guests may report what they can open (KAI-181), with an optional address for the outcome.
    report: async ({ target, reason, note, contactEmail }) => {
      await api.report({ boardId: board.id, target, reason, ...(note ? { note } : {}), ...(contactEmail ? { contactEmail } : {}) });
    },
    uploadImage: needsAccount('Uploading images'),
    uploadFile: needsAccount('Uploading files'),
    renameBoard: needsAccount('Renaming boards'),
    saveThumbnail: async () => undefined,
    openShareDialog: signUp,
    navigate: (path) => (path === '/app' || path === '/' ? signUp() : deps.navigate(path)),
    notify: deps.notify,
    serverNow,
    // Guests never see the member directory (nor anyone's email); presence and comments name people.
    listMembers: async () => [],
    lookupUsers: (ids) => lookupUsers(board.id, ids),
    inviteMember: needsAccount('Inviting people'),
    unfurl: needsAccount('Link previews'),
    listTemplates: async () => [],
    loadTemplate: needsAccount('Saved templates'),
    saveTemplate: needsAccount('Saving templates'),
    shareTemplate: needsAccount('Sharing templates'),
    deleteTemplate: needsAccount('Saved templates'),
    versions: unavailableVersionHistory('Version history needs a free Freero account.'),
    activity: { list: (before) => api.boardActivity(board.id, before) },
    importImage: needsAccount('Copying images'),
    fetchImage: needsAccount('Copying images'),
  };
}

const readAsDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/**
 * An operator's read-only preview of a reported board (BoardEngine `initialState`): role viewer,
 * no network, nothing it could change or send anywhere.
 */
export function createPreviewHost(board: { id: string; title: string }, deps: Pick<HostDeps, 'user' | 'navigate' | 'notify'>): Host {
  const no = (what: string) => async () => Promise.reject(new Error(`${what} isn’t available in a moderation preview.`));
  return {
    user: deps.user,
    board: { id: `preview-${board.id}`, title: board.title, role: 'viewer', canExport: false, team: null },
    syncUrl: '',
    uploadImage: no('Uploading'),
    uploadFile: no('Uploading'),
    renameBoard: no('Renaming'),
    saveThumbnail: async () => undefined,
    openShareDialog: () => deps.notify('This is a read-only snapshot for moderation.', 'info'),
    navigate: deps.navigate,
    notify: deps.notify,
    serverNow: () => Date.now(),
    listMembers: async () => [],
    lookupUsers: async () => [],
    inviteMember: no('Inviting'),
    unfurl: no('Link previews'),
    listTemplates: async () => [],
    loadTemplate: no('Templates'),
    saveTemplate: no('Templates'),
    deleteTemplate: no('Templates'),
    shareTemplate: no('Templates'),
    versions: unavailableVersionHistory('Version history isn’t available in a moderation preview.'),
    importImage: no('Copying images'),
    fetchImage: no('Fetching images'),
    report: no('Reporting'),
  };
}

const LOCAL_ROLES: Role[] = ['owner', 'editor', 'commenter', 'viewer'];

/**
 * Offline sandbox (/board/local, dev only): no server, no account. The engine keeps the doc in
 * localStorage. `?role=viewer|commenter|editor` previews role-aware UI; `?name=` sets the user name.
 */
export function createLocalHost(title: string, deps: Omit<HostDeps, 'user' | 'openShareDialog'>): Host {
  const params = new URLSearchParams(window.location.search);
  const role = (LOCAL_ROLES as string[]).includes(params.get('role') ?? '') ? (params.get('role') as Role) : 'owner';
  const user: HostUser = { id: 'local-user', name: params.get('name') || 'You', color: '#5b3ff0', avatarUrl: null };
  return {
    user,
    board: { id: 'local', title, role },
    syncUrl: '',
    uploadImage: async (file) => ({ url: await readAsDataUrl(file) }),
    uploadFile: async (file) => ({ url: await readAsDataUrl(file) }),
    async renameBoard(next) {
      deps.onTitleChange(next);
    },
    saveThumbnail: async () => undefined,
    openShareDialog: () => deps.notify('Sharing needs a real board — the local sandbox is offline.', 'info'),
    navigate: deps.navigate,
    notify: deps.notify,
    serverNow: () => Date.now(),
    listMembers: async () => [user],
    lookupUsers: async (ids) => (ids.includes(user.id) ? [user] : []),
    inviteMember: async () => Promise.reject(new Error('Inviting people needs a real board — the local sandbox is offline.')),
    // Offline sandbox: no previews (the embed card shows the plain link).
    unfurl: async () => Promise.reject(new Error('Link previews need a real board.')),
    // Offline sandbox: saved templates live on the server (no account here).
    listTemplates: async () => [],
    loadTemplate: async () => Promise.reject(new Error('Saved templates need a real board.')),
    saveTemplate: async () => Promise.reject(new Error('Saving templates needs a real board — the local sandbox is offline.')),
    deleteTemplate: async () => Promise.reject(new Error('Saved templates need a real board.')),
    shareTemplate: async () => Promise.reject(new Error('Sharing templates needs a real board.')),
    versions: unavailableVersionHistory('Version history needs a real board — the local sandbox keeps no versions.'),
    // No server to fetch through: images placed by URL stay linked (CORS hosts still export,
    // others are reported as missing by the export).
    importImage: async () => Promise.reject(new Error('Copying images needs a real board.')),
    fetchImage: async () => Promise.reject(new Error('Copying images needs a real board.')),
    report: async () => Promise.reject(new Error('Reporting needs a real board — the local sandbox is offline.')),
  };
}

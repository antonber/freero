// Builds the engine's Host — the one typed contract between the app shell and the engine.
import type { BoardSummary, Role } from '@freero/shared';
import { unavailableVersionHistory, type Host, type HostUser } from '@engine';
import type { ToastApi } from '@ui';
import { wsBase } from '../api/client';
import {
  deleteTemplate,
  fetchImage,
  importImage,
  listMembers,
  listTemplates,
  loadTemplate,
  renameBoard,
  saveTemplate,
  saveThumbnail,
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
    board: { id: board.id, title: board.title, role: board.role },
    syncUrl: `${wsBase()}/ws/boards`,
    uploadImage,
    uploadFile,
    async renameBoard(title) {
      await renameBoard(board.id, title);
      deps.onTitleChange(title);
    },
    saveThumbnail: (dataUrl) => saveThumbnail(board.id, dataUrl),
    openShareDialog: deps.openShareDialog,
    navigate: deps.navigate,
    notify: deps.notify,
    serverNow,
    listMembers: () => listMembers(board.id),
    unfurl,
    listTemplates,
    loadTemplate,
    saveTemplate,
    deleteTemplate,
    versions: versionHistory(board.id),
    importImage,
    fetchImage,
  };
}

const readAsDataUrl = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

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
    // Offline sandbox: no previews (the embed card shows the plain link).
    unfurl: async () => Promise.reject(new Error('Link previews need a real board.')),
    // Offline sandbox: saved templates live on the server (no account here).
    listTemplates: async () => [],
    loadTemplate: async () => Promise.reject(new Error('Saved templates need a real board.')),
    saveTemplate: async () => Promise.reject(new Error('Saving templates needs a real board — the local sandbox is offline.')),
    deleteTemplate: async () => Promise.reject(new Error('Saved templates need a real board.')),
    versions: unavailableVersionHistory('Version history needs a real board — the local sandbox keeps no versions.'),
    // No server to fetch through: images placed by URL stay linked (CORS hosts still export,
    // others are reported as missing by the export).
    importImage: async () => Promise.reject(new Error('Copying images needs a real board.')),
    fetchImage: async () => Promise.reject(new Error('Copying images needs a real board.')),
  };
}

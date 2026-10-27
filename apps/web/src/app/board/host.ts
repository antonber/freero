// Builds the engine's Host — the one typed contract between the app shell and the engine.
import type { BoardSummary, Role } from '@freero/shared';
import type { Host, HostUser } from '@engine';
import { wsBase } from '../api/client';
import { renameBoard, saveThumbnail, uploadImage } from '../hostServices';

export interface HostDeps {
  user: HostUser;
  navigate(path: string): void;
  notify(message: string, kind?: 'info' | 'success' | 'error'): void;
  openShareDialog(): void;
  onTitleChange(title: string): void;
}

export function createServerHost(board: BoardSummary, deps: HostDeps): Host {
  return {
    user: deps.user,
    board: { id: board.id, title: board.title, role: board.role },
    syncUrl: `${wsBase()}/ws/boards`,
    uploadImage,
    async renameBoard(title) {
      await renameBoard(board.id, title);
      deps.onTitleChange(title);
    },
    saveThumbnail: (dataUrl) => saveThumbnail(board.id, dataUrl),
    openShareDialog: deps.openShareDialog,
    navigate: deps.navigate,
    notify: deps.notify,
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
  return {
    user: { id: 'local-user', name: params.get('name') || 'You', color: '#5b3ff0', avatarUrl: null },
    board: { id: 'local', title, role },
    syncUrl: '',
    uploadImage: async (file) => ({ url: await readAsDataUrl(file) }),
    async renameBoard(next) {
      deps.onTitleChange(next);
    },
    saveThumbnail: async () => undefined,
    openShareDialog: () => deps.notify('Sharing needs a real board — the local sandbox is offline.', 'info'),
    navigate: deps.navigate,
    notify: deps.notify,
  };
}

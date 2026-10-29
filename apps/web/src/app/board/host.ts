// Builds the engine's Host — the one typed contract between the app shell and the engine.
import { EMBED_WS_PROTOCOL, type BoardAiStatus, type BoardSummary, type BoardTrackersResponse, type EmbedRedeemResponse, type Role } from '@freero/shared';
import { unavailableVersionHistory, type Host, type HostEngage, type HostUser } from '@engine';
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
  resolveObjects,
  uploadAttachment,
  uploadFile,
  uploadImage,
  versionHistory,
  downloadBoardFile,
  docsFrom,
  saveAs,
  walkthroughsOf,
  decisionsOf,
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
  /** What the server said about AI on this board for this user (null: AI is off on this server). */
  ai?: BoardAiStatus | null;
  /** Tracker connections this user may use here (empty: no tracker entry points). */
  trackers?: BoardTrackersResponse['connections'];
}

/** Live activities (KAI-132): the same REST for accounts and guests (the server decides who may answer). */
export function engageOf(boardId: string): HostEngage {
  return {
    state: (aid) => api.activity(boardId, aid),
    answer: (aid, answer) => api.answerActivity(boardId, aid, answer),
    withdraw: (aid) => api.withdrawAnswer(boardId, aid),
    ask: (aid, text) => api.askQuestion(boardId, aid, text),
    upvote: (aid, qid, on) => api.upvoteQuestion(boardId, aid, qid, on),
    moderate: (aid, qid, patch) => api.moderateQuestion(boardId, aid, qid, patch),
    reveal: (aid, revealed) => api.revealActivity(boardId, aid, revealed),
    clear: (aid) => api.clearActivity(boardId, aid),
  };
}

/** The board's call link (KAI-134): anyone on the board reads it, editors set it. */
export function callOf(boardId: string): NonNullable<Host['call']> {
  return { get: () => api.boardCall(boardId), set: (req) => api.setBoardCall(boardId, req) };
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

/** Live embeds on this board (KAI-127): the workspace's switch and the operator's extra origins. */
const embedsOf = (p: BoardSummary['permissions']) => ({ enabled: p.liveEmbeds !== false, extraOrigins: p.embedOrigins ?? [] });

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
      call: board.call ?? null,
      jitsiCalls: board.permissions.jitsiCalls === true,
      embeds: embedsOf(board.permissions),
    },
    syncUrl: `${wsBase()}/ws/boards`,
    uploadImage,
    uploadFile,
    uploadAttachment,
    downloadFile: downloadBoardFile(board.id),
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
    resolveObjects,
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
    engage: engageOf(board.id),
    call: callOf(board.id),
    walkthroughs: walkthroughsOf(board.id, { canDownload: board.permissions.canExport, signedIn: true }),
    decisions: decisionsOf(board.id),
    docs: docsFrom(board.id, deps.navigate),
    // AI entry points exist only when the server said this user may use AI here.
    ...(deps.ai?.available ? { ai: { provider: deps.ai.provider ?? '', source: deps.ai.source ?? 'instance', run: (body) => api.runAi(board.id, body) } } : {}),
    // Tracker entry points exist only when the server listed a connection this user may use here.
    ...(deps.trackers?.length
      ? {
          trackers: {
            connections: deps.trackers,
            projects: (connectionId) => api.trackerProjects(board.id, connectionId),
            preview: async (body) => (await api.trackerPreview(board.id, body)).issues,
            send: (body) => api.trackerSend(board.id, body),
            importIssues: (body) => api.trackerImport(board.id, body),
            sync: async (linkId) => void (await api.trackerSync(board.id, linkId)),
            unlink: async (linkId) => void (await api.trackerUnlink(board.id, linkId)),
          },
        }
      : {}),
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
    board: { id: board.id, title: board.title, role: board.role, canExport: board.permissions.canExport, team: null, signedIn: false, call: board.call ?? null, embeds: embedsOf(board.permissions) },
    syncUrl: `${wsBase()}/ws/boards`,
    // Guests may report what they can open (KAI-181), with an optional address for the outcome.
    report: async ({ target, reason, note, contactEmail }) => {
      await api.report({ boardId: board.id, target, reason, ...(note ? { note } : {}), ...(contactEmail ? { contactEmail } : {}) });
    },
    uploadImage: needsAccount('Uploading images'),
    uploadFile: needsAccount('Uploading files'),
    uploadAttachment: needsAccount('Uploading files'),
    // Visitors may download what the board's workspace lets them (the server decides).
    downloadFile: downloadBoardFile(board.id),
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
    // Smart links resolve for guests too: they learn only what their one board lets them see.
    resolveObjects,
    listTemplates: async () => [],
    loadTemplate: needsAccount('Saved templates'),
    saveTemplate: needsAccount('Saving templates'),
    shareTemplate: needsAccount('Sharing templates'),
    deleteTemplate: needsAccount('Saved templates'),
    versions: unavailableVersionHistory('Version history needs a free Freero account.'),
    activity: { list: (before) => api.boardActivity(board.id, before) },
    importImage: needsAccount('Copying images'),
    fetchImage: needsAccount('Copying images'),
    // Guests answer live activities when the activity lets visitors in (the server checks).
    engage: engageOf(board.id),
    call: { get: () => api.boardCall(board.id), set: needsAccount('Setting the call link') },
    // Visitors watch walkthroughs and open decisions; recording and commenting need an account.
    walkthroughs: walkthroughsOf(board.id, { canDownload: board.permissions.canExport, signedIn: false }),
    decisions: decisionsOf(board.id),
  };
}

/**
 * A live board view inside an AI assistant (KAI-171, app/embed): the person, on this one board, in a
 * third-party frame without their session cookie. The socket signs in with the view's short-lived
 * token (a WebSocket subprotocol); everything else that needs the account (uploads, templates,
 * history, sharing, exports) points to "Open in Freero", which the view's header offers.
 */
export function createEmbedHost(view: EmbedRedeemResponse, deps: { notify: Host['notify'] }): Host {
  const board = view.board;
  const inFreero = (what: string) => () => Promise.reject(new Error(`${what}: open the board in Freero.`));
  const openInFreero = () => deps.notify('Use “Open in Freero” above for the full app.', 'info');
  return {
    user: view.user,
    board: {
      id: board.id,
      title: board.title,
      role: board.role,
      canExport: false,
      team: null,
      call: board.call ?? null,
      embeds: embedsOf(board.permissions),
    },
    syncUrl: `${wsBase()}/ws/embed/boards`,
    syncProtocols: [EMBED_WS_PROTOCOL, view.token],
    uploadImage: inFreero('Adding images'),
    uploadFile: inFreero('Adding files'),
    uploadAttachment: inFreero('Adding files'),
    renameBoard: inFreero('Renaming the board'),
    saveThumbnail: async () => undefined,
    openShareDialog: () => deps.notify('Use “Share with team” above.', 'info'),
    navigate: openInFreero,
    notify: deps.notify,
    serverNow: () => Date.now(),
    listMembers: async () => [view.user],
    lookupUsers: async (ids) => (ids.includes(view.user.id) ? [view.user] : []),
    inviteMember: inFreero('Inviting people'),
    unfurl: inFreero('Link previews'),
    listTemplates: async () => [],
    loadTemplate: inFreero('Saved templates'),
    saveTemplate: inFreero('Saving templates'),
    shareTemplate: inFreero('Sharing templates'),
    deleteTemplate: inFreero('Saved templates'),
    versions: unavailableVersionHistory('Version history is in Freero itself.'),
    importImage: inFreero('Copying images'),
    fetchImage: inFreero('Copying images'),
    report: inFreero('Reporting'),
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

/**
 * A decision snapshot (KAI-161, /decision/:id): the frozen board shown read-only (BoardEngine
 * `initialState`), role viewer, no network — nothing on it can change, and nobody sees you there.
 * Smart links on it still resolve (for this reader, like everywhere).
 */
export function createDecisionHost(decision: { id: string; title: string }, deps: Pick<HostDeps, 'user' | 'navigate' | 'notify'>): Host {
  const frozen = createPreviewHost({ id: decision.id, title: decision.title }, deps);
  const no = (what: string) => async () => Promise.reject(new Error(`${what} isn’t possible on a frozen decision.`));
  return {
    ...frozen,
    board: { ...frozen.board, id: `decision-${decision.id}` },
    uploadImage: no('Uploading'),
    uploadFile: no('Uploading'),
    openShareDialog: () => deps.notify('This is a frozen decision: copy its link to share it with people who can open the board.', 'info'),
    versions: unavailableVersionHistory('A frozen decision has no version history of its own.'),
    resolveObjects,
  };
}

/**
 * The Host of a live board shown INSIDE a doc (KAI-152, engine LiveBoardView): the boards socket
 * (the server admits it with the reader's own access to that board), the people and link lookups
 * of that board, nothing that changes anything — the embed is read-only; edits happen on the board.
 */
export function createBoardInDocHost(deps: Pick<HostDeps, 'user' | 'navigate' | 'notify'>): Host {
  const no = (what: string) => async () => Promise.reject(new Error(`${what}: open the board to change it.`));
  return {
    user: deps.user,
    board: { id: '', title: '', role: 'viewer', canExport: false, team: null },
    syncUrl: `${wsBase()}/ws/boards`,
    uploadImage: no('Uploading'),
    uploadFile: no('Uploading'),
    renameBoard: no('Renaming'),
    saveThumbnail: async () => undefined,
    openShareDialog: () => undefined,
    navigate: deps.navigate,
    notify: deps.notify,
    serverNow,
    listMembers: async () => [],
    lookupUsers: async () => [],
    inviteMember: no('Inviting'),
    unfurl: no('Link previews'),
    resolveObjects,
    listTemplates: async () => [],
    loadTemplate: no('Templates'),
    saveTemplate: no('Templates'),
    deleteTemplate: no('Templates'),
    shareTemplate: no('Templates'),
    versions: unavailableVersionHistory('Open the board to see its versions.'),
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
    uploadAttachment: async (file) => ({ url: await readAsDataUrl(file) }),
    // No server, no policy: the item's own data: URL.
    downloadFile: async ({ src, name }) => saveAs(src, name),
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

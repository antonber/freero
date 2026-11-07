// Builds the engine's Host — the one typed contract between the app shell and the engine.
import {
  EMBED_WS_PROTOCOL,
  PUBLIC_EMBED_VIEW_ONLY,
  PUBLIC_EMBED_WS_PROTOCOL,
  type BoardAiStatus,
  type BoardSummary,
  type BoardTrackersResponse,
  type EmbedRedeemResponse,
  type Role,
} from '@freero/shared';
import { unavailableVersionHistory, type Host, type HostEngage, type HostUser } from '@engine';
import type { ToastApi } from '@ui';
import { track } from '../analytics/bridge';
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
  publishTemplateTo,
  unfurl,
  resolveObjects,
  uploadAttachment,
  uploadFile,
  uploadImage,
  versionHistory,
  downloadBoardFile,
  commentFilesOf,
  downloadBackupOf,
  docsFrom,
  saveAs,
  walkthroughsOf,
  decisionsOf,
} from '../hostServices';
import { holdBackup, RESTORE_PATH } from '../lib/pendingBackup';
import { takeShare } from '../lib/pendingShare';
import { serverNow, syncServerClock } from './serverClock';
import { getThemePreference, setThemePreference } from '../lib/theme';

import { t } from '../messages';
/** The theme for people without an account here: kept in this browser only. */
const browserTheme: NonNullable<Host['colorTheme']> = { get: getThemePreference, set: setThemePreference };

export interface HostDeps {
  user: HostUser;
  navigate(path: string): void;
  notify: Host['notify'];
  openShareDialog(): void;
  onTitleChange(title: string): void;
  /** The board's team workspace, when the user is a full member of it (templates can be shared there). */
  team?: { id: string; name: string; company?: { id: string; name: string } | null } | null;
  /** What the server said about AI on this board for this user (null: AI is off on this server). */
  ai?: BoardAiStatus | null;
  /** Tracker connections this user may use here (empty: no tracker entry points). */
  trackers?: BoardTrackersResponse['connections'];
  /** Opens "Report a problem" (app/problems) for this board. */
  reportProblem?: Host['reportProblem'];
  /**
   * The server ended this board's socket because access is gone (4403). The page re-asks for the
   * board: a link that just got a password offers its password form in place (#39).
   */
  onAccessLost?: () => void;
  /** The person's theme (app/lib/theme.ts; saved to their account when they have one). */
  colorTheme?: Host['colorTheme'];
  /** #178: where the device copy of the board is kept (app/offline), when it may be. */
  offline?: Host['offline'];
}

/** Close code of a board socket whose access ended (y-websocket contract in @freero/shared api.ts). */
const WS_CLOSE_NO_ACCESS = 4403;

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
    setKey: (aid, key) => api.setActivityKey(boardId, aid, key),
    runQuiz: (aid, run) => api.runQuiz(boardId, aid, run),
    copyKey: (aid, from) => api.copyActivityKey(boardId, aid, from),
  };
}

/** Who presents the board (#146): the server keeps it, so handing over is checked there. */
export function presentationOf(boardId: string): NonNullable<Host['presentation']> {
  return {
    start: (frameId) => api.presentation(boardId, { action: 'start', frameId }),
    handoff: (to, frameId) => api.presentation(boardId, { action: 'handoff', to, frameId }),
    end: () => api.presentation(boardId, { action: 'end' }),
  };
}

/** The board's call link (KAI-134): anyone on the board reads it, editors set it. */
export function callOf(boardId: string): NonNullable<Host['call']> {
  return { get: () => api.boardCall(boardId), set: (req) => api.setBoardCall(boardId, req), token: () => api.boardCallToken(boardId) };
}

/** A signed-in person's own view settings on this board (kept on the server, so they follow them). */
export function personalViewsOf(boardId: string): NonNullable<Host['personalViews']> {
  return {
    list: async () => (await api.personalViews(boardId)).views,
    save: async (itemId, viewId, settings) => void (await api.savePersonalView(boardId, { itemId, viewId, settings })),
  };
}

/** The board's workspace's own sticker sets (#138). */
export function stickersOf(boardId: string): NonNullable<Host['stickers']> {
  return {
    list: () => api.stickers(boardId),
    createSet: async (name) => (await api.createStickerSet(boardId, name)).set,
    add: (setId, file, name) => api.addSticker(setId, file, name),
    removeSet: async (setId) => void (await api.removeStickerSet(setId)),
    remove: async (setId, stickerId) => void (await api.removeSticker(setId, stickerId)),
  };
}

/** The board's workspace's shape packs (#4): a pack is uploaded as one ZIP through the upload checks, then named. */
export function shapePacksOf(boardId: string): NonNullable<Host['shapePacks']> {
  return {
    list: () => api.shapePacks(boardId),
    async create(name, zip, opts) {
      const { url } = await api.uploadAttachment(zip, boardId);
      return api.createShapePack(boardId, name, url, !!opts?.personal);
    },
    rename: async (packId, name) => (await api.renameShapePack(packId, name)).pack,
    remove: async (packId) => void (await api.removeShapePack(packId)),
  };
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
      canCopy: board.permissions.canCopy !== false,
      coOwner: board.coOwner === true,
      team: deps.team ? { name: deps.team.name, company: deps.team.company?.name ?? null } : null,
      call: board.call ?? null,
      jitsiCalls: board.permissions.jitsiCalls === true,
      ...(board.permissions.dockedCalls ? { dockedCalls: board.permissions.dockedCalls } : {}),
      embeds: embedsOf(board.permissions),
    },
    syncUrl: `${wsBase()}/ws/boards`,
    ...(deps.onAccessLost ? { onConnectionEnded: (end: { code: number }) => void (end.code === WS_CLOSE_NO_ACCESS && deps.onAccessLost?.()) } : {}),
    personalViews: personalViewsOf(board.id),
    stickers: stickersOf(board.id),
    ...(board.permissions.gifs ? { gifs: { search: (q: string, pos: string | null) => api.searchGifs(board.id, q, pos), place: (media: string) => api.placeGif(board.id, media) } } : {}),
    // #171: Figma's consent leaves the board and comes back to it with ?figma=connected.
    ...(board.permissions.figma
      ? {
          figma: {
            status: () => api.figmaStatus(),
            connect: () => window.location.assign(api.figmaConnectUrl(`${window.location.pathname}?figma=1`)),
            disconnect: () => api.figmaDisconnect().then(() => undefined),
            recentFiles: () => api.figmaFiles(),
            frames: (fileKey: string) => api.figmaFrames(fileKey),
            place: (fileKey: string, nodeId: string) => api.placeFigmaFrame(board.id, fileKey, nodeId),
          },
        }
      : {}),
    // #62: a Miro board read with the person's own token (the server keeps neither).
    ...(board.permissions.miroImport ? { boardImport: { miro: (b: string, token: string, signal?: AbortSignal) => api.importFromMiro(board.id, b, token, signal) } } : {}),
    shapePacks: shapePacksOf(board.id),
    // #162: publish this board to the community template gallery (reviewed before it is public).
    gallery: {
      submit: async (request) => (await api.submitGalleryTemplate({ ...request, boardId: board.id })).template,
      mine: async () => (await api.myGalleryTemplates()).templates,
      withdraw: async (id) => void (await api.withdrawGalleryTemplate(id)),
    },
    uploadImage: (file) => uploadImage(file, board.id),
    uploadFile: (file) => uploadFile(file, board.id),
    uploadAttachment: (file) => uploadAttachment(file, board.id),
    downloadFile: downloadBoardFile(board.id),
    commentFile: commentFilesOf(board.id),
    downloadBackup: downloadBackupOf(board.id),
    openBackup(file) {
      holdBackup(file);
      deps.navigate(RESTORE_PATH);
    },
    takeShared: () => takeShare(board.id),
    async renameBoard(title) {
      await renameBoard(board.id, title);
      deps.onTitleChange(title);
    },
    saveThumbnail: (dataUrl) => saveThumbnail(board.id, dataUrl),
    reportExport: (format) => reportExport(board.id, format),
    openShareDialog: deps.openShareDialog,
    ...(deps.reportProblem ? { reportProblem: deps.reportProblem } : {}),
    ...(deps.colorTheme ? { colorTheme: deps.colorTheme } : {}),
    ...(deps.offline ? { offline: deps.offline } : {}),
    navigate: deps.navigate,
    notify: deps.notify,
    track,
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
    ...(deps.team?.company ? { publishTemplate: publishTemplateTo(deps.team.company.id) } : {}),
    deleteTemplate,
    versions: versionHistory(board.id),
    activity: {
      list: (before) => api.boardActivity(board.id, before),
      catchUp: () => api.boardCatchUp(board.id),
      catchUpChanges: () => api.boardCatchUpChanges(board.id),
    },
    importImage,
    fetchImage,
    report: reportOn(board.id),
    engage: engageOf(board.id),
    icebreakers: { roll: (elementId) => api.rollIcebreaker(board.id, elementId) },
    presentation: presentationOf(board.id),
    call: callOf(board.id),
    walkthroughs: walkthroughsOf(board.id, { canDownload: board.permissions.canExport, signedIn: true }),
    decisions: decisionsOf(board.id),
    docs: docsFrom(board.id, deps.navigate),
    // AI entry points exist only when the server said this user may use AI here.
    ...(deps.ai?.available ? { ai: { provider: deps.ai.provider ?? '', source: deps.ai.source ?? 'instance', run: (body) => api.runAi(board.id, body) } } : {}),
    // The board assistant (#1): also for viewers and commenters the workspace lets use AI.
    ...(deps.ai?.assistant
      ? {
          assistant: {
            provider: deps.ai.provider ?? '',
            source: deps.ai.source ?? 'instance',
            canPropose: deps.ai.assistant.canPropose,
            conversation: async () => (await api.assistant(board.id)).messages,
            ask: (body) => api.askAssistant(board.id, body),
            clear: async () => void (await api.clearAssistant(board.id)),
            workflows: {
              list: () => api.aiWorkflows(board.id),
              create: async (input) => (await api.createAiWorkflow(board.id, input)).workflow,
              update: async (id, patch) => (await api.updateAiWorkflow(board.id, id, patch)).workflow,
              remove: async (id) => void (await api.deleteAiWorkflow(board.id, id)),
              run: (id, ids) => api.runAiWorkflow(board.id, id, ids),
            },
          },
        }
      : {}),
    // AI exists on this server but not for this person here: actions may show greyed out with why.
    ...(deps.ai && !deps.ai.available ? { aiUnavailable: deps.ai.reason ?? t('aiIsnTAvailableOn') } : {}),
    // Tracker entry points exist only when the server listed a connection this user may use here.
    ...(deps.trackers?.length
      ? {
          trackers: {
            connections: deps.trackers,
            projects: (connectionId) => api.trackerProjects(board.id, connectionId),
            preview: async (body) => (await api.trackerPreview(board.id, body)).issues,
            send: (body) => api.trackerSend(board.id, body),
            importIssues: (body) => api.trackerImport(board.id, body),
            sprints: (connectionId, project) => api.trackerSprints(board.id, connectionId, project),
            issueTypes: (connectionId, project) => api.trackerIssueTypes(board.id, connectionId, project),
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
  deps: { user: HostUser; navigate(path: string): void; notify: Host['notify']; signUpPath: string; onAccessLost?: () => void },
): Host {
  syncServerClock();
  const needsAccount = (what: string) => () => Promise.reject(new Error(`${what} needs a free Freero account.`));
  const signUp = () =>
    deps.notify(t('signUpFreeToShare'), 'info', {
      action: { label: t('signUp'), run: () => deps.navigate(deps.signUpPath) },
    });
  return {
    user: deps.user,
    board: {
      id: board.id,
      title: board.title,
      role: board.role,
      canExport: board.permissions.canExport,
      canCopy: board.permissions.canCopy !== false,
      team: null,
      signedIn: false,
      call: board.call ?? null,
      ...(board.permissions.dockedCalls ? { dockedCalls: board.permissions.dockedCalls } : {}),
      embeds: embedsOf(board.permissions),
    },
    syncUrl: `${wsBase()}/ws/boards`,
    ...(deps.onAccessLost ? { onConnectionEnded: (end: { code: number }) => void (end.code === WS_CLOSE_NO_ACCESS && deps.onAccessLost?.()) } : {}),
    // Guests may report what they can open (KAI-181), with an optional address for the outcome.
    report: async ({ target, reason, note, contactEmail }) => {
      await api.report({ boardId: board.id, target, reason, ...(note ? { note } : {}), ...(contactEmail ? { contactEmail } : {}) });
    },
    uploadImage: needsAccount(t('uploadingImages')),
    uploadFile: needsAccount(t('uploadingFiles')),
    uploadAttachment: needsAccount(t('uploadingFiles')),
    // Visitors may download what the board's workspace lets them (the server decides).
    downloadFile: downloadBoardFile(board.id),
    commentFile: commentFilesOf(board.id),
    renameBoard: needsAccount(t('renamingBoards')),
    saveThumbnail: async () => undefined,
    colorTheme: browserTheme,
    openShareDialog: signUp,
    navigate: (path) => (path === '/app' || path === '/' ? signUp() : deps.navigate(path)),
    notify: deps.notify,
    serverNow,
    // Guests never see the member directory (nor anyone's email); presence and comments name people.
    listMembers: async () => [],
    lookupUsers: (ids) => lookupUsers(board.id, ids),
    inviteMember: needsAccount(t('invitingPeople')),
    unfurl: needsAccount(t('linkPreviews')),
    // Smart links resolve for guests too: they learn only what their one board lets them see.
    resolveObjects,
    listTemplates: async () => [],
    loadTemplate: needsAccount(t('savedTemplates')),
    saveTemplate: needsAccount(t('savingTemplates')),
    shareTemplate: needsAccount(t('sharingTemplates')),
    deleteTemplate: needsAccount(t('savedTemplates')),
    versions: unavailableVersionHistory(t('versionHistoryNeedsAFree')),
    activity: { list: (before) => api.boardActivity(board.id, before) },
    importImage: needsAccount(t('copyingImages')),
    fetchImage: needsAccount(t('copyingImages')),
    // Guests answer live activities when the activity lets visitors in (the server checks).
    engage: engageOf(board.id),
    presentation: presentationOf(board.id),
    call: { get: () => api.boardCall(board.id), set: needsAccount(t('settingTheCallLink')), token: () => api.boardCallToken(board.id) },
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
  const openInFreero = () => deps.notify(t('useOpenInFreeroAbove'), 'info');
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
    uploadImage: inFreero(t('addingImages')),
    uploadFile: inFreero(t('addingFiles')),
    uploadAttachment: inFreero(t('addingFiles')),
    renameBoard: inFreero(t('renamingTheBoard')),
    saveThumbnail: async () => undefined,
    openShareDialog: () => deps.notify(t('useShareWithTeamAbove'), 'info'),
    navigate: openInFreero,
    notify: deps.notify,
    serverNow: () => Date.now(),
    listMembers: async () => [view.user],
    lookupUsers: async (ids) => (ids.includes(view.user.id) ? [view.user] : []),
    inviteMember: inFreero(t('invitingPeople')),
    unfurl: inFreero(t('linkPreviews')),
    listTemplates: async () => [],
    loadTemplate: inFreero(t('savedTemplates')),
    saveTemplate: inFreero(t('savingTemplates')),
    shareTemplate: inFreero(t('sharingTemplates')),
    deleteTemplate: inFreero(t('savedTemplates')),
    versions: unavailableVersionHistory(t('versionHistoryIsInFreero')),
    importImage: inFreero(t('copyingImages')),
    fetchImage: inFreero(t('copyingImages')),
    report: inFreero('Reporting'),
  };
}

/** What a board embedded on another site (#2, app/embed PublicEmbedPage) runs as. */
export interface PublicEmbedView {
  board: { id: string; title: string; role: Role; permissions?: BoardSummary['permissions']; call?: BoardSummary['call'] };
  /** The person signed in from the embed, or a visitor without an account (`token` null). */
  user: HostUser;
  token: string | null;
  /** The socket only reads (editing not started in the frame, or a read-only embed). */
  viewOnly: boolean;
  boardUrl: string;
}

/**
 * The Host of a board embedded on another site (#2): its own socket (/ws/embed/b) signed in with
 * the embed's board-bound token, or none for a visitor (read-only) — never the session cookie.
 * Nothing navigates the frame: whatever would leave the board opens Freero in a new tab.
 */
export function createPublicEmbedHost(view: PublicEmbedView, deps: { notify: Host['notify']; onConnectionEnded: NonNullable<Host['onConnectionEnded']> }): Host {
  const { board } = view;
  const open = (path: string) => void window.open(new URL(path, view.boardUrl).toString(), '_blank', 'noopener');
  const inFreero = (what: string) => () => Promise.reject(new Error(`${what}: open the board in Freero.`));
  return {
    user: view.user,
    board: {
      id: board.id,
      title: board.title,
      role: board.role,
      canExport: false,
      team: null,
      signedIn: view.token !== null,
      call: board.call ?? null,
      embeds: board.permissions ? embedsOf(board.permissions) : { enabled: false, extraOrigins: [] },
    },
    syncUrl: `${wsBase()}/ws/embed/b`,
    syncProtocols: [PUBLIC_EMBED_WS_PROTOCOL, ...(view.token ? [view.token] : []), ...(view.viewOnly ? [PUBLIC_EMBED_VIEW_ONLY] : [])],
    onConnectionEnded: deps.onConnectionEnded,
    uploadImage: inFreero(t('addingImages')),
    uploadFile: inFreero(t('addingFiles')),
    uploadAttachment: inFreero(t('addingFiles')),
    renameBoard: inFreero(t('renamingTheBoard')),
    saveThumbnail: async () => undefined,
    openShareDialog: () => open(view.boardUrl),
    navigate: (path) => open(path),
    notify: deps.notify,
    serverNow: () => Date.now(),
    listMembers: async () => [view.user],
    lookupUsers: async (ids) => (ids.includes(view.user.id) ? [view.user] : []),
    inviteMember: inFreero(t('invitingPeople')),
    unfurl: inFreero(t('linkPreviews')),
    listTemplates: async () => [],
    loadTemplate: inFreero(t('savedTemplates')),
    saveTemplate: inFreero(t('savingTemplates')),
    shareTemplate: inFreero(t('sharingTemplates')),
    deleteTemplate: inFreero(t('savedTemplates')),
    versions: unavailableVersionHistory(t('versionHistoryIsInFreero')),
    importImage: inFreero(t('copyingImages')),
    fetchImage: inFreero(t('copyingImages')),
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
    openShareDialog: () => deps.notify(t('thisIsAReadOnly'), 'info'),
    navigate: deps.navigate,
    notify: deps.notify,
    serverNow: () => Date.now(),
    listMembers: async () => [],
    lookupUsers: async () => [],
    inviteMember: no('Inviting'),
    unfurl: no(t('linkPreviews')),
    listTemplates: async () => [],
    loadTemplate: no('Templates'),
    saveTemplate: no('Templates'),
    deleteTemplate: no('Templates'),
    shareTemplate: no('Templates'),
    versions: unavailableVersionHistory(t('versionHistoryIsnTAvailable')),
    importImage: no(t('copyingImages')),
    fetchImage: no(t('fetchingImages')),
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
    openShareDialog: () => deps.notify(t('thisIsAFrozenDecision'), 'info'),
    versions: unavailableVersionHistory(t('aFrozenDecisionHasNo')),
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
    unfurl: no(t('linkPreviews')),
    resolveObjects,
    listTemplates: async () => [],
    loadTemplate: no('Templates'),
    saveTemplate: no('Templates'),
    deleteTemplate: no('Templates'),
    shareTemplate: no('Templates'),
    versions: unavailableVersionHistory(t('openTheBoardToSee')),
    importImage: no(t('copyingImages')),
    fetchImage: no(t('fetchingImages')),
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
    colorTheme: browserTheme,
    openShareDialog: () => deps.notify(t('sharingNeedsARealBoard'), 'info'),
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
    versions: unavailableVersionHistory(t('versionHistoryNeedsAReal')),
    // No server to fetch through: images placed by URL stay linked (CORS hosts still export,
    // others are reported as missing by the export).
    importImage: async () => Promise.reject(new Error('Copying images needs a real board.')),
    fetchImage: async () => Promise.reject(new Error('Copying images needs a real board.')),
    report: async () => Promise.reject(new Error('Reporting needs a real board — the local sandbox is offline.')),
  };
}

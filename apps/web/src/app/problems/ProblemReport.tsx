// "Report a problem" everywhere a signed-in person is: the dialog (one per app), how it opens —
// `useProblemReport().open()` from menus, the board menu through Host.reportProblem, and the
// keyboard shortcut — and what it sends. The screenshot is taken BEFORE the dialog shows, so it is
// what the person was looking at; they can remove it before sending.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImageOff, RotateCcw, Trash2 } from 'lucide-react';
import { describeDevice, MAX_PROBLEM_NOTE, type ProblemDiagnostics, type Role } from '@freero/shared';
import { Button, Modal, TextArea, formatShortcut, isApplePlatform } from '@ui';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { collectDiagnostics } from './diagnostics';
import { captureScreen } from './capture';
import { t } from '../messages';
import './problems.css';

/** Ctrl+Alt+P (⌘⌥P on a Mac): the same everywhere; on boards the board's command answers it. */
export const PROBLEM_SHORTCUT = 'mod+alt+p';
/** Where someone follows their reports. */
export const MY_PROBLEMS_PATH = '/settings#problems';

type BoardContext = { id: string; role: Role };
interface ProblemReportApi {
  /** Takes the screenshot, then opens the dialog. `board`: the board the person is on, if any. */
  open(board?: BoardContext | null): void;
  /** A board page says it is showing (its command handles the shortcut there); returns the cleanup. */
  showingBoard(board: BoardContext): () => void;
  /** False for visitors without an account: no reports. */
  available: boolean;
}

const Ctx = createContext<ProblemReportApi>({ open: () => undefined, showingBoard: () => () => undefined, available: false });
export const useProblemReport = () => useContext(Ctx);

const CAPTURE_TIMEOUT_MS = 8000;
const frames = (n: number) => new Promise<void>((r) => {
  const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : r());
  step(n);
});

async function screenshot(): Promise<Blob | null> {
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), CAPTURE_TIMEOUT_MS));
  const shot = captureScreen().catch(() => null);
  return Promise.race([shot, timeout]);
}

interface Pending {
  shot: Blob | null;
  diagnostics: ProblemDiagnostics;
}

export function ProblemReportProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const available = !!user && !user.deletionScheduledFor;
  const [pending, setPending] = useState<Pending | null>(null);
  const busy = useRef(false);
  const board = useRef<BoardContext | null>(null);

  const open = useCallback(
    (on?: BoardContext | null) => {
      if (!available || busy.current) return;
      busy.current = true;
      document.documentElement.classList.add('fr-problem-capturing');
      const diagnostics = collectDiagnostics(on ?? board.current);
      // Let a menu that was clicked close first: the picture is the page, not the menu.
      void frames(2)
        .then(screenshot)
        .then((shot) => setPending({ shot, diagnostics }))
        .finally(() => document.documentElement.classList.remove('fr-problem-capturing'));
    },
    [available],
  );
  const close = useCallback(() => {
    busy.current = false;
    setPending(null);
  }, []);
  const showingBoard = useCallback((b: BoardContext) => {
    board.current = b;
    return () => {
      if (board.current === b) board.current = null;
    };
  }, []);

  // The shortcut outside boards (dashboard, settings, docs…). On a board its command answers it.
  useEffect(() => {
    if (!available) return;
    const onKey = (e: KeyboardEvent) => {
      if (board.current || e.repeat || e.shiftKey || !e.altKey || e.code !== 'KeyP') return;
      if (!(isApplePlatform() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)) return;
      e.preventDefault();
      open();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [available, open]);

  const value = useMemo(() => ({ open, showingBoard, available }), [open, showingBoard, available]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {pending ? <ProblemDialog pending={pending} onClose={close} /> : null}
    </Ctx.Provider>
  );
}

const errorText = (e: unknown) => (e instanceof ApiError && e.status < 500 ? e.message : t('yourReportCouldnTBe'));

function ProblemDialog({ pending, onClose }: { pending: Pending; onClose: () => void }) {
  const navigate = useNavigate();
  const [note, setNote] = useState('');
  const [contactOk, setContactOk] = useState(false);
  const [withShot, setWithShot] = useState(pending.shot !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ screenshotFailed: boolean } | null>(null);
  // Made and revoked by the same effect (StrictMode runs it twice: a URL made once would be revoked).
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!pending.shot) return;
    const url = URL.createObjectURL(pending.shot);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pending.shot]);

  const send = async () => {
    if (!note.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { problem } = await api.createProblem({ note: note.trim(), contactOk, diagnostics: pending.diagnostics });
      let screenshotFailed = false;
      if (withShot && pending.shot) await api.attachProblemScreenshot(problem.id, pending.shot).catch(() => (screenshotFailed = true));
      setSent({ screenshotFailed });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (sent)
    return (
      <Modal
        open
        onClose={onClose}
        title={t('thanksSent')}
        width={460}
        className="fr-problem"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                onClose();
                navigate(MY_PROBLEMS_PATH);
              }}
            >{t('seeMyReports')}</Button>
            <Button variant="primary" onClick={onClose} data-autofocus>{t('done')}</Button>
          </>
        }
      >
        <div>
          <p className="fr-problem__p">{t('freeroSTeamReadsEvery')}</p>
          {sent.screenshotFailed ? <p className="fr-problem__warn">{t('theScreenshotCouldnTBe')}</p> : null}
        </div>
      </Modal>
    );

  return (
    <Modal
      open
      onClose={onClose}
      dismissable={!note.trim()}
      title={t('reportAProblem')}
      description={t('somethingBrokenOrConfusingTell')}
      width={520}
      className="fr-problem"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
          <Button variant="primary" onClick={send} disabled={!note.trim()} loading={busy}>{t('sendReport')}</Button>
        </>
      }
    >
      <div className="fr-problem__form">
        <TextArea
          label={t('whatWentWrongWhatDid')}
          value={note}
          rows={4}
          maxLength={MAX_PROBLEM_NOTE}
          required
          data-autofocus
          placeholder={t('eGIDraggedA')}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
          }}
        />
        <Screenshot captured={pending.shot !== null} preview={preview} included={withShot} onToggle={setWithShot} />
        <label className="fr-problem__check">
          <input type="checkbox" checked={contactOk} onChange={(e) => setContactOk(e.target.checked)} />
          <span>{t('okToContactMeAbout')}</span>
        </label>
        <Diagnostics d={pending.diagnostics} />
        {error ? (
          <p className="fr-problem__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function Screenshot({ captured, preview, included, onToggle }: { captured: boolean; preview: string | null; included: boolean; onToggle: (on: boolean) => void }) {
  if (!captured)
    return (
      <div className="fr-problem__shot fr-problem__shot--none">
        <ImageOff size={16} aria-hidden /> <span>{t('noScreenshotThisPageCouldn')}</span>
      </div>
    );
  if (!included)
    return (
      <div className="fr-problem__shot fr-problem__shot--none">
        <ImageOff size={16} aria-hidden /> <span>{t('noScreenshotWillBeSent')}</span>
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => onToggle(true)}>{t('addItBack')}</Button>
      </div>
    );
  return (
    <figure className="fr-problem__shot">
      {preview ? <img className="fr-problem__img" src={preview} alt={t('screenshotOfWhatYouWere')} /> : <div className="fr-problem__img" />}
      <figcaption className="fr-problem__caption">
        <span>{t('aScreenshotOfYourScreen')}</span>
        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => onToggle(false)}>{t('remove')}</Button>
      </figcaption>
    </figure>
  );
}

const ROLE_PHRASE: Record<Role, string> = { owner: t('youOwnIt'), editor: t('youCanEdit'), commenter: t('youCanComment'), viewer: t('youCanView') };

function Diagnostics({ d }: { d: ProblemDiagnostics }) {
  const board: Array<[string, ReactNode]> = d.boardId
    ? [
        [
          'Board',
          <span key="b">
            <code>{d.boardId}</code>
            {d.role ? ` · ${ROLE_PHRASE[d.role]}` : ''}
          </span>,
        ],
      ]
    : [];
  const rows: Array<[string, ReactNode]> = [
    ['Page', <code key="p">{d.path}</code>],
    ...board,
    [t('appRelease'), t('addedByFreeroSServer')],
    ['Browser', `${describeDevice(d.userAgent)}${d.language ? ` · ${d.language}` : ''}`],
    ['Window', `${d.viewport.width} × ${d.viewport.height} at ${d.viewport.dpr}× pixels`],
    ['Time', `${new Date(d.at).toLocaleString()}${d.timeZone ? ` (${d.timeZone})` : ''}`],
    [t('recentErrors'), d.events.length ? t('lengthListedBelow', { length: d.events.length }) : 'None'],
  ];
  return (
    <details className="fr-problem__details">
      <summary>{t('alsoSentDetailsThatHelp')}</summary>
      <dl className="fr-problem__dl">
        {rows.map(([k, v]) => (
          <div key={k} className="fr-problem__row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {d.events.length ? (
        <ol className="fr-problem__events">
          {d.events.map((e, i) => (
            <li key={i}>
              <code>{e.message}</code>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="fr-problem__fine">{t('webAddressesAreSentWithout')}</p>
    </details>
  );
}

/** The shortcut as this platform writes it (⌘⌥P, Ctrl+Alt+P). */
export const problemShortcutLabel = () => formatShortcut(PROBLEM_SHORTCUT);

/** While a board page shows, it tells the dialog which board and role (the shortcut is then the board's). */
export function useShowingBoard(board: BoardContext | null): void {
  const { showingBoard } = useProblemReport();
  const id = board?.id;
  const role = board?.role;
  useEffect(() => (id && role ? showingBoard({ id, role }) : undefined), [id, role, showingBoard]);
}

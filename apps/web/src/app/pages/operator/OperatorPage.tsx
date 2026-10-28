// /operator — the moderation queue (KAI-142). Operators (OPERATOR_EMAILS, verified) review reports
// and appeals, look at the reported board in a read-only snapshot, and act: turn a board's link
// off, take a board down, remove an uploaded file, suspend an account, or undo any of these. Every
// action is recorded on the server and its subject is emailed the statement written here.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Eye, FileX2, History, Link2Off, RefreshCw, Search, ShieldAlert, ShieldCheck, Trash2, UserX } from 'lucide-react';
import {
  REPORT_REASONS,
  type ModeratedBoard,
  type ModeratedUpload,
  type ModeratedUser,
  type ModerationActionKind,
  type ModerationActionRecord,
  type ModerationItem,
  type ReportReason,
  type SuspensionBoards,
} from '@freero/shared';
import { Button, Input, Logo, Modal, SegmentedControl, Select, Spinner, TextArea, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { relativeTime } from '../../lib/time';
import { NotFoundPage } from '../NotFoundPage';
import './operator.css';

const ACTION_LABEL: Record<ModerationActionKind, string> = {
  'board.disable_link': 'Turn off link sharing',
  'board.restore_link': 'Restore link sharing',
  'board.take_down': 'Take board down',
  'board.restore': 'Restore board',
  'board.delete': 'Delete board for good',
  'upload.remove': 'Remove file',
  'upload.restore': 'Restore file',
  'upload.purge': 'Delete kept copy for good',
  'user.suspend': 'Suspend account',
  'user.restore': 'Lift suspension',
};
/** Actions against someone: they get the statement and an appeal link. */
const ADVERSE: ModerationActionKind[] = ['board.disable_link', 'board.take_down', 'board.delete', 'upload.remove', 'upload.purge', 'user.suspend'];
const reasonLabel = (r: ReportReason | null) => REPORT_REASONS.find((x) => x.id === r)?.label ?? '—';
const message = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Try again.');

interface PendingAction {
  action: ModerationActionKind;
  targetId: string;
  targetLabel: string;
  reason: ReportReason;
  itemId?: string;
  boardId?: string;
}

export function OperatorPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [items, setItems] = useState<ModerationItem[] | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const notify = useToast();

  useEffect(() => {
    document.title = 'Moderation · Freero';
    api.moderationAccess().then(
      (r) => setAllowed(r.operator),
      () => setAllowed(false),
    );
  }, []);

  const load = useCallback(() => {
    setItems(null);
    api.moderationQueue(status).then(
      (r) => setItems(r.items),
      (e) => {
        notify(message(e), 'error');
        setItems([]);
      },
    );
  }, [status, notify]);
  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  const resolve = async (item: ModerationItem, outcome: 'actioned' | 'dismissed') => {
    try {
      await api.resolveModerationItem(item.id, outcome, '');
      notify(outcome === 'dismissed' ? 'Dismissed' : 'Marked as handled', 'success');
      load();
    } catch (e) {
      notify(message(e), 'error');
    }
  };

  if (allowed === null) return <div className="fr-op fr-op--center"><Spinner size={22} label="Loading" /></div>;
  if (!allowed) return <NotFoundPage />;
  return (
    <div className="fr-op">
      <header className="fr-op__bar">
        <Link to="/app" className="fr-op__home" aria-label="Back to the dashboard">
          <ArrowLeft size={16} aria-hidden />
          <Logo size={26} />
        </Link>
        <h1 className="fr-op__title">
          <ShieldAlert size={18} aria-hidden /> Moderation
        </h1>
        <SegmentedControl
          aria-label="Queue"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'closed', label: 'Closed' },
          ]}
        />
        <Button variant="ghost" size="sm" icon={RefreshCw} onClick={load}>
          Refresh
        </Button>
      </header>
      <div className="fr-op__body">
        <main className="fr-op__queue" aria-label={status === 'open' ? 'Open items' : 'Closed items'}>
          {items === null ? (
            <Spinner size={22} label="Loading the queue" />
          ) : items.length === 0 ? (
            <p className="fr-op__empty">{status === 'open' ? 'Nothing waiting for review.' : 'Nothing closed yet.'}</p>
          ) : (
            items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onAct={setPending}
                onResolve={(o) => resolve(item, o)}
                onHistory={() => setHistory(item.boardId)}
              />
            ))
          )}
        </main>
        <aside className="fr-op__tools" aria-label="Look up">
          <AccountLookup onAct={setPending} />
          <FileLookup onAct={setPending} />
        </aside>
      </div>
      {pending && (
        <ActionDialog
          pending={pending}
          onClose={() => setPending(null)}
          onDone={(a) => {
            setPending(null);
            notify(`${ACTION_LABEL[a.action]}: done. The person affected was emailed.`, 'success');
            load();
          }}
        />
      )}
      {history && <HistoryDialog boardId={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function Chip({ tone, children }: { tone: 'danger' | 'warn' | 'muted' | 'ok'; children: ReactNode }) {
  return <span className={`fr-op-chip fr-op-chip--${tone}`}>{children}</span>;
}

function BoardState({ board }: { board: ModeratedBoard }) {
  return (
    <span className="fr-op-chips">
      {board.removedAt !== null && <Chip tone="danger">Taken down</Chip>}
      {board.linkBlocked && <Chip tone="warn">Link blocked</Chip>}
      {board.deletedAt !== null && <Chip tone="muted">In the owner’s trash</Chip>}
      {!board.linkBlocked && board.linkAccess !== 'none' && <Chip tone="muted">Link: can {board.linkAccess === 'viewer' ? 'view' : board.linkAccess === 'commenter' ? 'comment' : 'edit'}</Chip>}
      {board.owner?.suspended && <Chip tone="danger">Owner suspended</Chip>}
    </span>
  );
}

function targetText(item: ModerationItem): string {
  const t = item.target;
  if (t.kind === 'board') return 'The whole board';
  if (t.kind === 'element') return `Item ${t.id}`;
  if (t.kind === 'upload') return `File ${t.id}`;
  if (t.kind === 'comment') return `Comment ${t.id?.split(':')[1] ?? ''} in thread ${t.id?.split(':')[0] ?? ''}`;
  return 'Their account';
}

function previewPath(item: ModerationItem): string {
  const t = item.target;
  const q = t.kind === 'element' && t.id ? `?item=${encodeURIComponent(t.id)}` : t.kind === 'comment' && t.id ? `?thread=${encodeURIComponent(t.id.split(':')[0])}` : '';
  return `/operator/boards/${encodeURIComponent(item.boardId ?? '')}/preview${q}`;
}

function ItemCard({
  item,
  onAct,
  onResolve,
  onHistory,
}: {
  item: ModerationItem;
  onAct: (p: PendingAction) => void;
  onResolve: (outcome: 'actioned' | 'dismissed') => void;
  onHistory: () => void;
}) {
  const b = item.board;
  const reason = item.reason ?? 'other';
  const act = (action: ModerationActionKind, targetId: string, targetLabel: string, extra: Partial<PendingAction> = {}) =>
    onAct({ action, targetId, targetLabel, reason, itemId: item.status === 'open' ? item.id : undefined, ...extra });
  const open = item.status === 'open';
  return (
    <article className={`fr-op-card${item.kind === 'appeal' ? ' fr-op-card--appeal' : ''}`}>
      <div className="fr-op-card__head">
        <Chip tone={item.kind === 'appeal' ? 'warn' : 'danger'}>{item.kind === 'appeal' ? 'Appeal' : reasonLabel(item.reason)}</Chip>
        <h2 className="fr-op-card__board">{item.boardTitle || (item.target.kind === 'user' ? 'Account suspension' : 'Untitled board')}</h2>
        {b && <BoardState board={b} />}
        <span className="fr-op-card__when" title={new Date(item.createdAt).toLocaleString()}>
          {relativeTime(item.createdAt, Date.now())}
        </span>
      </div>
      <dl className="fr-op-card__facts">
        <dt>About</dt>
        <dd>{targetText(item)}</dd>
        <dt>{item.kind === 'appeal' ? 'From' : 'Reported by'}</dt>
        <dd>
          {item.reporter ? `${item.reporter.name} <${item.reporter.email}>` : item.contactEmail ? `Visitor <${item.contactEmail}>` : 'A visitor without an account'}
        </dd>
        {b?.owner && (
          <>
            <dt>Board owner</dt>
            <dd>
              {b.owner.name} &lt;{b.owner.email}&gt;
            </dd>
          </>
        )}
        {item.action && (
          <>
            <dt>Appealed</dt>
            <dd>
              {ACTION_LABEL[item.action.action]} · {reasonLabel(item.action.reason)} · {new Date(item.action.createdAt).toLocaleDateString()}
              {item.action.operator ? ` · by ${item.action.operator.name}` : ''}
            </dd>
          </>
        )}
        {!open && (
          <>
            <dt>Outcome</dt>
            <dd>
              {item.status === 'actioned' ? 'Actioned' : 'Dismissed'}
              {item.resolutionNote ? ` — ${item.resolutionNote}` : ''}
            </dd>
          </>
        )}
      </dl>
      {item.message && <blockquote className="fr-op-card__message">{item.message}</blockquote>}
      {item.target.kind === 'upload' && item.target.id && (
        <span className="fr-op-card__files">
          {/* Attachments (file cards) are never served at /uploads: only the audited operator download. */}
          {!item.target.id.endsWith('.bin') && (
            <a className="fr-op-card__file" href={`/uploads/${item.target.id}`} target="_blank" rel="noreferrer noopener">
              Open the file in a new tab
            </a>
          )}
          <a className="fr-op-card__file" href={api.moderationUploadFileUrl(item.target.id)} download>
            Download to review
          </a>
        </span>
      )}
      <div className="fr-op-card__actions">
        {item.boardId && b && (
          <>
            <Link className="fr-op-btnlink" to={previewPath(item)} target="_blank" rel="noopener">
              <Eye size={15} aria-hidden /> Preview
            </Link>
            <Button size="sm" variant="ghost" icon={History} onClick={onHistory}>
              History
            </Button>
            {b.linkBlocked ? (
              <Button size="sm" icon={ShieldCheck} onClick={() => act('board.restore_link', b.id, `“${b.title}”`)}>
                Restore link
              </Button>
            ) : (
              <Button size="sm" icon={Link2Off} onClick={() => act('board.disable_link', b.id, `“${b.title}”`)}>
                Turn off link
              </Button>
            )}
            {b.removedAt !== null ? (
              <>
                <Button size="sm" icon={ShieldCheck} onClick={() => act('board.restore', b.id, `“${b.title}”`)}>
                  Restore board
                </Button>
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => act('board.delete', b.id, `“${b.title}”`)}>
                  Delete for good
                </Button>
              </>
            ) : (
              <Button size="sm" variant="danger" onClick={() => act('board.take_down', b.id, `“${b.title}”`)}>
                Take down
              </Button>
            )}
          </>
        )}
        {item.target.kind === 'upload' && item.target.id &&
          (item.action?.action === 'upload.remove' ? (
            <Button size="sm" icon={ShieldCheck} onClick={() => act('upload.restore', item.target.id!, `file ${item.target.id}`)}>
              Restore file
            </Button>
          ) : (
            <Button size="sm" icon={FileX2} onClick={() => act('upload.remove', item.target.id!, `file ${item.target.id}`, { boardId: item.boardId ?? undefined })}>
              Remove file
            </Button>
          ))}
        {item.target.kind === 'user' && item.target.id && (
          <Button size="sm" icon={ShieldCheck} onClick={() => act('user.restore', item.target.id!, 'this account')}>
            Lift suspension
          </Button>
        )}
        {b?.owner && !b.owner.suspended && (
          <Button size="sm" variant="ghost" icon={UserX} onClick={() => act('user.suspend', b.owner!.id, `${b.owner!.name} <${b.owner!.email}>`)}>
            Suspend owner
          </Button>
        )}
        {open && (
          <span className="fr-op-card__close">
            <Button size="sm" variant="ghost" onClick={() => onResolve('dismissed')}>
              {item.kind === 'appeal' ? 'Keep decision' : 'Dismiss'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onResolve('actioned')}>
              Mark handled
            </Button>
          </span>
        )}
      </div>
    </article>
  );
}

function ActionDialog({ pending, onClose, onDone }: { pending: PendingAction; onClose: () => void; onDone: (a: ModerationActionRecord) => void }) {
  const adverse = ADVERSE.includes(pending.action);
  const [reason, setReason] = useState<ReportReason>(pending.reason);
  const [statement, setStatement] = useState('');
  const [note, setNote] = useState('');
  const [boards, setBoards] = useState<SuspensionBoards | 'keep'>('keep');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const { action } = await api.moderate({
        action: pending.action,
        targetId: pending.targetId,
        reason,
        statement: statement.trim(),
        note: note.trim() || undefined,
        itemId: pending.itemId,
        boardId: pending.boardId,
        boards: pending.action === 'user.suspend' && boards !== 'keep' ? boards : undefined,
      });
      onDone(action);
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={ACTION_LABEL[pending.action]}
      description={`For ${pending.targetLabel}.${pending.action === 'board.delete' ? ' Its content is deleted and can’t be brought back.' : ''} This is recorded with your name.`}
      width={500}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={adverse ? 'danger' : 'primary'} onClick={run} loading={busy} disabled={adverse && !statement.trim()}>
            {ACTION_LABEL[pending.action]}
          </Button>
        </>
      }
    >
      <div className="fr-op-form">
        <label className="fr-op-form__label" htmlFor="fr-op-reason">
          Reason
        </label>
        <Select<ReportReason> id="fr-op-reason" aria-label="Reason" value={reason} onChange={setReason} options={REPORT_REASONS.map((r) => ({ value: r.id, label: r.label }))} />
        {pending.action === 'user.suspend' && (
          <>
            <label className="fr-op-form__label" htmlFor="fr-op-boards">
              Their boards
            </label>
            <Select<SuspensionBoards | 'keep'>
              id="fr-op-boards"
              aria-label="Their boards"
              value={boards}
              onChange={setBoards}
              options={[
                { value: 'keep', label: 'Leave them as they are' },
                { value: 'take_down', label: 'Take down every board they own' },
                { value: 'disable_link', label: 'Turn off the link of every board they share' },
              ]}
            />
            <p className="fr-op-form__hint">Each board is recorded as its own action. Lifting the suspension brings them all back.</p>
          </>
        )}
        <TextArea
          label={adverse ? 'Statement to the person affected (required)' : 'Message to the person affected (optional)'}
          hint="Sent by email with the decision. Say what was wrong and where; it is also what they appeal against."
          value={statement}
          rows={4}
          maxLength={2000}
          onChange={(e) => setStatement(e.target.value)}
        />
        <TextArea label="Internal note (operators only)" value={note} rows={2} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
        {error && (
          <p className="fr-op-form__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function HistoryDialog({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const [data, setData] = useState<{ board: ModeratedBoard; items: ModerationItem[]; actions: ModerationActionRecord[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.moderationBoard(boardId).then(setData, (e) => setError(message(e)));
  }, [boardId]);
  return (
    <Modal open onClose={onClose} title={data ? `History of “${data.board.title}”` : 'History'} width={560}>
      {error ? (
        <p className="fr-op-form__error">{error}</p>
      ) : !data ? (
        <Spinner size={20} label="Loading" />
      ) : (
        <div className="fr-op-history">
          <h3>Actions</h3>
          {data.actions.length === 0 ? (
            <p className="fr-op__empty">No actions yet.</p>
          ) : (
            <ul>
              {data.actions.map((a) => (
                <li key={a.id}>
                  <strong>{ACTION_LABEL[a.action]}</strong> · {reasonLabel(a.reason)} · {new Date(a.createdAt).toLocaleString()}
                  {a.operator ? ` · ${a.operator.name}` : ''}
                  {a.subject && <div className="fr-op-history__note">About {a.subject.name} &lt;{a.subject.email}&gt;</div>}
                  {a.statement && <div className="fr-op-history__text">“{a.statement}”</div>}
                  {a.note && <div className="fr-op-history__note">Note: {a.note}</div>}
                </li>
              ))}
            </ul>
          )}
          <h3>Reports and appeals</h3>
          <ul>
            {data.items.map((i) => (
              <li key={i.id}>
                <strong>{i.kind === 'appeal' ? 'Appeal' : reasonLabel(i.reason)}</strong> · {i.status} · {new Date(i.createdAt).toLocaleString()}
                {i.message && <div className="fr-op-history__text">“{i.message}”</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

function AccountLookup({ onAct }: { onAct: (p: PendingAction) => void }) {
  const [email, setEmail] = useState('');
  const [user, setUser] = useState<ModeratedUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const find = async () => {
    setError(null);
    setUser(null);
    try {
      setUser((await api.moderationUser(email.trim())).user);
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <section className="fr-op-tool">
      <h2>Account</h2>
      <form
        className="fr-op-tool__row"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <Input aria-label="Email address" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button size="sm" icon={Search} type="submit" disabled={!email.trim()}>
          Find
        </Button>
      </form>
      {error && <p className="fr-op-form__error">{error}</p>}
      {user && (
        <div className="fr-op-tool__result">
          <span>
            {user.name} &lt;{user.email}&gt; {user.suspended && <Chip tone="danger">Suspended</Chip>}
          </span>
          <Button
            size="sm"
            variant={user.suspended ? 'secondary' : 'danger'}
            onClick={() => onAct({ action: user.suspended ? 'user.restore' : 'user.suspend', targetId: user.id, targetLabel: `${user.name} <${user.email}>`, reason: 'spam' })}
          >
            {user.suspended ? 'Lift suspension' : 'Suspend'}
          </Button>
        </div>
      )}
    </section>
  );
}

function FileLookup({ onAct }: { onAct: (p: PendingAction) => void }) {
  const [name, setName] = useState('');
  const [upload, setUpload] = useState<ModeratedUpload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const find = async () => {
    setError(null);
    setUpload(null);
    const n = name.trim().replace(/^.*\/uploads\//, '');
    try {
      setUpload((await api.moderationUpload(n)).upload);
    } catch (e) {
      setError(message(e));
    }
  };
  return (
    <section className="fr-op-tool">
      <h2>Uploaded file</h2>
      <form
        className="fr-op-tool__row"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <Input aria-label="File URL or name" placeholder="/uploads/…" value={name} onChange={(e) => setName(e.target.value)} />
        <Button size="sm" icon={Search} type="submit" disabled={!name.trim()}>
          Find
        </Button>
      </form>
      {error && <p className="fr-op-form__error">{error}</p>}
      {upload && (
        <div className="fr-op-tool__result">
          <span>
            {upload.name} · {upload.owner ? upload.owner.email : 'no owner'} {upload.removedAt !== null && <Chip tone="danger">Removed</Chip>}
          </span>
          {(upload.removedAt === null || upload.restorable) && (
            <a className="fr-op-card__file" href={api.moderationUploadFileUrl(upload.name)} download>
              Download to review
            </a>
          )}
          <span className="fr-op-chips">
            {upload.removedAt === null ? (
              <Button size="sm" variant="danger" onClick={() => onAct({ action: 'upload.remove', targetId: upload.name, targetLabel: `file ${upload.name}`, reason: 'illegal' })}>
                Remove
              </Button>
            ) : upload.restorable ? (
              <>
                <Button size="sm" onClick={() => onAct({ action: 'upload.restore', targetId: upload.name, targetLabel: `file ${upload.name}`, reason: 'other' })}>
                  Restore
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onAct({ action: 'upload.purge', targetId: upload.name, targetLabel: `file ${upload.name}`, reason: 'illegal' })}>
                  Delete kept copy
                </Button>
              </>
            ) : null}
          </span>
        </div>
      )}
    </section>
  );
}

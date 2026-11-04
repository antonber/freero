// /operator — the moderation queue (KAI-142). Operators (OPERATOR_EMAILS, verified) review reports
// and appeals, look at the reported board in a read-only snapshot, and act: turn a board's link
// off, take a board down, remove an uploaded file, suspend an account, or undo any of these. Every
// action is recorded on the server and its subject is emailed the statement written here.
// "Listings" (#87): community submissions for Apps & agents, approved or declined here; live ones
// can be featured or removed (and a removal appealed), with the same record and audit trail.
// "Templates" (#162): boards submitted to the public community template gallery (GalleryView).
// "Problems": what people sent with "Report a problem" (bugs, not abuse; ProblemsView).
// "Microsoft 365 apps" (#112, #114): this instance's Teams app and Copilot agent packages, to upload
// in Teams (docs/integrations/teams.md).
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Eye, FileX2, History, Link2Off, RefreshCw, Search, ShieldAlert, ShieldCheck, Star, Trash2, UserX, X } from 'lucide-react';
import {
  INTEGRATION_CATEGORIES,
  LISTING_SURFACES,
  REPORT_REASONS,
  type ListingForReview,
  type MicrosoftIntegrationsInfo,
  type HostAppInfo,
  type ListingStatus,
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
import { GalleryView } from './GalleryView';
import { ProblemsView } from './ProblemsView';
import { t as tr } from './messages';
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
  'listing.approve': 'Approve listing',
  'listing.reject': 'Decline listing',
  'listing.remove': 'Remove listing',
  'listing.restore': 'Restore listing',
  'listing.feature': 'Feature listing',
  'listing.unfeature': 'Stop featuring',
  'gallery.approve': tr('approveTemplate'),
  'gallery.reject': tr('declineTemplate'),
  'gallery.remove': tr('removeTemplate'),
  'gallery.restore': tr('restoreTemplate'),
};
/** Actions against someone: they get the statement (required) and, where it can be undone, an appeal link. */
const ADVERSE: ModerationActionKind[] = ['board.disable_link', 'board.take_down', 'board.delete', 'upload.remove', 'upload.purge', 'user.suspend', 'listing.reject', 'listing.remove', 'gallery.reject', 'gallery.remove'];
/** Reviews of a listing, not findings of abuse: no report reason to pick. */
const NO_REASON: ModerationActionKind[] = ['listing.approve', 'listing.reject', 'listing.restore', 'listing.feature', 'listing.unfeature', 'gallery.approve', 'gallery.reject', 'gallery.restore'];
type View = 'open' | 'closed' | 'listings' | 'gallery' | 'problems';
const LISTING_STATUSES: Array<{ value: ListingStatus; label: string }> = [
  { value: 'pending', label: tr('waitingForReview') },
  { value: 'approved', label: tr('live') },
  { value: 'rejected', label: tr('declined') },
  { value: 'removed', label: tr('removed') },
];
const reasonLabel = (r: ReportReason | null) => REPORT_REASONS.find((x) => x.id === r)?.label ?? '—';
const message = (e: unknown) => (e instanceof ApiError ? e.message : tr('somethingWentWrongTryAgain'));

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
  const [params, setParams] = useSearchParams();
  const asked = params.get('view');
  const view: View = asked === 'listings' || asked === 'closed' || asked === 'problems' || asked === 'gallery' ? asked : 'open';
  const [problemsVersion, setProblemsVersion] = useState(0);
  const [galleryVersion, setGalleryVersion] = useState(0);
  const setView = (v: View) => setParams(v === 'open' ? {} : { view: v }, { replace: true });
  const status = view === 'closed' ? 'closed' : 'open';
  const [listingStatus, setListingStatus] = useState<ListingStatus>('pending');
  const [listings, setListings] = useState<ListingForReview[] | null>(null);
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
    if (view === 'problems') return setProblemsVersion((v) => v + 1);
    if (view === 'gallery') return setGalleryVersion((v) => v + 1);
    if (view === 'listings') {
      setListings(null);
      api.moderationListings(listingStatus).then(
        (r) => setListings(r.listings),
        (e) => {
          notify(message(e), 'error');
          setListings([]);
        },
      );
      return;
    }
    setItems(null);
    api.moderationQueue(status).then(
      (r) => setItems(r.items),
      (e) => {
        notify(message(e), 'error');
        setItems([]);
      },
    );
  }, [view, status, listingStatus, notify]);
  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  const resolve = async (item: ModerationItem, outcome: 'actioned' | 'dismissed') => {
    try {
      await api.resolveModerationItem(item.id, outcome, '');
      notify(outcome === 'dismissed' ? tr('dismissed') : tr('markedAsHandled'), 'success');
      load();
    } catch (e) {
      notify(message(e), 'error');
    }
  };

  if (allowed === null) return <div className="fr-op fr-op--center"><Spinner size={22} label={tr('loading')} /></div>;
  if (!allowed) return <NotFoundPage />;
  return (
    <div className="fr-op">
      <header className="fr-op__bar">
        <Link to="/app" className="fr-op__home" aria-label={tr('backToTheDashboard')}>
          <ArrowLeft size={16} aria-hidden />
          <Logo size={26} />
        </Link>
        <h1 className="fr-op__title">
          <ShieldAlert size={18} aria-hidden />{' '}{tr('moderation')}</h1>
        <SegmentedControl<View>
          aria-label={tr('queue')}
          value={view}
          onChange={setView}
          options={[
            { value: 'open', label: tr('open') },
            { value: 'closed', label: tr('closed') },
            { value: 'listings', label: tr('listings') },
            { value: 'gallery', label: tr('templatesTab') },
            { value: 'problems', label: tr('problems') },
          ]}
        />
        <Button variant="ghost" size="sm" icon={RefreshCw} onClick={load}>{tr('refresh')}</Button>
      </header>
      {view === 'problems' ? (
        <div className="fr-op__body fr-op__body--single">
          <ProblemsView version={problemsVersion} />
        </div>
      ) : (
      <div className="fr-op__body">
        {view === 'gallery' ? (
          <GalleryView version={galleryVersion} onAct={setPending} />
        ) : view === 'listings' ? (
          <main className="fr-op__queue" aria-label={tr('communityListings')}>
            <div className="fr-op-listings__bar">
              <Select<ListingStatus> aria-label={tr('listings')} value={listingStatus} onChange={setListingStatus} options={LISTING_STATUSES} />
            </div>
            {listings === null ? (
              <Spinner size={22} label={tr('loadingListings')} />
            ) : listings.length === 0 ? (
              <p className="fr-op__empty">{listingStatus === 'pending' ? tr('noSubmissionIsWaitingFor') : tr('none')}</p>
            ) : (
              listings.map((l) => <ListingCard key={l.id} listing={l} onAct={setPending} />)
            )}
          </main>
        ) : (
        <main className="fr-op__queue" aria-label={status === 'open' ? tr('openItems') : tr('closedItems')}>
          {items === null ? (
            <Spinner size={22} label={tr('loadingTheQueue')} />
          ) : items.length === 0 ? (
            <p className="fr-op__empty">{status === 'open' ? tr('nothingWaitingForReview') : tr('nothingClosedYet')}</p>
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
        )}
        <aside className="fr-op__tools" aria-label={tr('lookUp')}>
          <AccountLookup onAct={setPending} />
          <FileLookup onAct={setPending} />
          <MicrosoftPackages />
          <OtherPlatformApps />
        </aside>
      </div>
      )}
      {pending && (
        <ActionDialog
          pending={pending}
          onClose={() => setPending(null)}
          onDone={(a) => {
            setPending(null);
            notify(tr('actionLabelDoneValue', { action_label: ACTION_LABEL[a.action], value: a.action === 'listing.feature' || a.action === 'listing.unfeature' ? '' : tr('thePersonAffectedWasEmailed') }), 'success');
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
      {board.removedAt !== null && <Chip tone="danger">{tr('takenDown')}</Chip>}
      {board.linkBlocked && <Chip tone="warn">{tr('linkBlocked')}</Chip>}
      {board.deletedAt !== null && <Chip tone="muted">{tr('inTheOwnerSTrash')}</Chip>}
      {!board.linkBlocked && board.linkAccess !== 'none' && <Chip tone="muted">{tr('linkCan')}{' '}{board.linkAccess === 'viewer' ? 'view' : board.linkAccess === 'commenter' ? 'comment' : 'edit'}</Chip>}
      {board.owner?.suspended && <Chip tone="danger">{tr('ownerSuspended')}</Chip>}
    </span>
  );
}

function targetText(item: ModerationItem): string {
  const t = item.target;
  if (t.kind === 'board') return tr('theWholeBoard');
  if (t.kind === 'element') return `Item ${t.id}`;
  if (t.kind === 'upload') return `File ${t.id}`;
  if (t.kind === 'comment') return tr('commentValueInThreadValue2', { value: t.id?.split(':')[1] ?? '', value2: t.id?.split(':')[0] ?? '' });
  if (t.kind === 'listing') return tr('aCommunityListingAppsAgents');
  if (t.kind === 'gallery') return tr('aCommunityTemplate');
  return tr('theirAccount');
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
        <Chip tone={item.kind === 'appeal' ? 'warn' : 'danger'}>{item.kind === 'appeal' ? tr('appeal') : reasonLabel(item.reason)}</Chip>
        <h2 className="fr-op-card__board">{item.boardTitle || (item.target.kind === 'user' ? tr('accountSuspension') : item.target.kind === 'listing' ? tr('aWithdrawnListing') : item.target.kind === 'gallery' ? tr('aWithdrawnTemplate') : tr('untitledBoard'))}</h2>
        {b && <BoardState board={b} />}
        {item.listing && <ListingChips status={item.listing.status} featured={item.listing.featured} />}
        <span className="fr-op-card__when" title={new Date(item.createdAt).toLocaleString()}>
          {relativeTime(item.createdAt, Date.now())}
        </span>
      </div>
      <dl className="fr-op-card__facts">
        <dt>{tr('about')}</dt>
        <dd>{targetText(item)}</dd>
        <dt>{item.kind === 'appeal' ? tr('from') : tr('reportedBy')}</dt>
        <dd>
          {item.reporter ? `${item.reporter.name} <${item.reporter.email}>` : item.contactEmail ? `Visitor <${item.contactEmail}>` : tr('aVisitorWithoutAnAccount')}
        </dd>
        {b?.owner && (
          <>
            <dt>{tr('boardOwner')}</dt>
            <dd>
              {b.owner.name} &lt;{b.owner.email}&gt;
            </dd>
          </>
        )}
        {item.action && (
          <>
            <dt>{tr('appealed')}</dt>
            <dd>
              {ACTION_LABEL[item.action.action]} · {reasonLabel(item.action.reason)} · {new Date(item.action.createdAt).toLocaleDateString()}
              {item.action.operator ? tr('byName', { name: item.action.operator.name }) : ''}
            </dd>
          </>
        )}
        {!open && (
          <>
            <dt>{tr('outcome')}</dt>
            <dd>
              {item.status === 'actioned' ? tr('actioned') : tr('dismissed')}
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
            <a className="fr-op-card__file" href={`/uploads/${item.target.id}`} target="_blank" rel="noreferrer noopener">{tr('openTheFileInA')}</a>
          )}
          <a className="fr-op-card__file" href={api.moderationUploadFileUrl(item.target.id)} download>{tr('downloadToReview')}</a>
        </span>
      )}
      <div className="fr-op-card__actions">
        {item.boardId && b && (
          <>
            <Link className="fr-op-btnlink" to={previewPath(item)} target="_blank" rel="noopener">
              <Eye size={15} aria-hidden />{' '}{tr('preview')}</Link>
            <Button size="sm" variant="ghost" icon={History} onClick={onHistory}>{tr('history')}</Button>
            {b.linkBlocked ? (
              <Button size="sm" icon={ShieldCheck} onClick={() => act('board.restore_link', b.id, `“${b.title}”`)}>{tr('restoreLink')}</Button>
            ) : (
              <Button size="sm" icon={Link2Off} onClick={() => act('board.disable_link', b.id, `“${b.title}”`)}>{tr('turnOffLink')}</Button>
            )}
            {b.removedAt !== null ? (
              <>
                <Button size="sm" icon={ShieldCheck} onClick={() => act('board.restore', b.id, `“${b.title}”`)}>{tr('restoreBoard')}</Button>
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => act('board.delete', b.id, `“${b.title}”`)}>{tr('deleteForGood')}</Button>
              </>
            ) : (
              <Button size="sm" variant="danger" onClick={() => act('board.take_down', b.id, `“${b.title}”`)}>{tr('takeDown')}</Button>
            )}
          </>
        )}
        {item.target.kind === 'upload' && item.target.id &&
          (item.action?.action === 'upload.remove' ? (
            <Button size="sm" icon={ShieldCheck} onClick={() => act('upload.restore', item.target.id!, tr('fileId', { id: item.target.id }))}>{tr('restoreFile')}</Button>
          ) : (
            <Button size="sm" icon={FileX2} onClick={() => act('upload.remove', item.target.id!, tr('fileId', { id: item.target.id }), { boardId: item.boardId ?? undefined })}>{tr('removeFile')}</Button>
          ))}
        {item.target.kind === 'user' && item.target.id && (
          <Button size="sm" icon={ShieldCheck} onClick={() => act('user.restore', item.target.id!, tr('thisAccount'))}>{tr('liftSuspension')}</Button>
        )}
        {item.listing &&
          (item.listing.status === 'removed' ? (
            <Button size="sm" icon={ShieldCheck} onClick={() => act('listing.restore', item.listing!.id, tr('theListingName', { name: item.listing!.name }))}>{tr('restoreListing')}</Button>
          ) : item.listing.status === 'approved' ? (
            <Button size="sm" variant="danger" onClick={() => act('listing.remove', item.listing!.id, tr('theListingName', { name: item.listing!.name }))}>{tr('removeListing')}</Button>
          ) : null)}
        {item.galleryTemplate &&
          (item.galleryTemplate.status === 'removed' ? (
            <Button size="sm" icon={ShieldCheck} onClick={() => act('gallery.restore', item.galleryTemplate!.id, tr('theTemplateName', { name: item.galleryTemplate!.title }))}>{tr('restoreTemplate')}</Button>
          ) : item.galleryTemplate.status === 'approved' ? (
            <Button size="sm" variant="danger" onClick={() => act('gallery.remove', item.galleryTemplate!.id, tr('theTemplateName', { name: item.galleryTemplate!.title }))}>{tr('removeTemplate')}</Button>
          ) : null)}
        {item.galleryTemplate?.status === 'approved' && (
          <a className="fr-op-btnlink" href={`/gallery/${encodeURIComponent(item.galleryTemplate.id)}`} target="_blank" rel="noopener noreferrer">
            <Eye size={15} aria-hidden />{' '}{tr('galleryPublicPage')}</a>
        )}
        {item.galleryTemplate?.submitter && !item.galleryTemplate.submitter.suspended && (
          <Button size="sm" variant="ghost" icon={UserX} onClick={() => act('user.suspend', item.galleryTemplate!.submitter!.id, `${item.galleryTemplate!.submitter!.name} <${item.galleryTemplate!.submitter!.email}>`)}>{tr('gallerySuspendSubmitter')}</Button>
        )}
        {item.listing?.submitter && !item.listing.submitter.suspended && (
          <Button
            size="sm"
            variant="ghost"
            icon={UserX}
            onClick={() => act('user.suspend', item.listing!.submitter!.id, `${item.listing!.submitter!.name} <${item.listing!.submitter!.email}>`)}
          >{tr('suspendDeveloper')}</Button>
        )}
        {b?.owner && !b.owner.suspended && (
          <Button size="sm" variant="ghost" icon={UserX} onClick={() => act('user.suspend', b.owner!.id, `${b.owner!.name} <${b.owner!.email}>`)}>{tr('suspendOwner')}</Button>
        )}
        {open && (
          <span className="fr-op-card__close">
            <Button size="sm" variant="ghost" onClick={() => onResolve('dismissed')}>
              {item.kind === 'appeal' ? tr('keepDecision') : tr('dismiss')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onResolve('actioned')}>{tr('markHandled')}</Button>
          </span>
        )}
      </div>
    </article>
  );
}

const LISTING_STATUS_CHIP: Record<ListingStatus, { tone: 'danger' | 'warn' | 'muted' | 'ok'; label: string }> = {
  pending: { tone: 'warn', label: tr('waitingForReview') },
  approved: { tone: 'ok', label: tr('live') },
  rejected: { tone: 'muted', label: tr('declined') },
  removed: { tone: 'danger', label: tr('removed') },
};

function ListingChips({ status, featured }: { status: ListingStatus; featured: boolean }) {
  return (
    <span className="fr-op-chips">
      <Chip tone={LISTING_STATUS_CHIP[status].tone}>{LISTING_STATUS_CHIP[status].label}</Chip>
      {featured && <Chip tone="ok">{tr('featured')}</Chip>}
    </span>
  );
}

/** A community listing to review. Everything in it is the developer's: shown as text, links not followed for them. */
function ListingCard({ listing: l, onAct }: { listing: ListingForReview; onAct: (p: PendingAction) => void }) {
  const act = (action: ModerationActionKind) => onAct({ action, targetId: l.id, targetLabel: `the listing “${l.name}”`, reason: 'other' });
  return (
    <article className="fr-op-card" data-testid="listing-review">
      <div className="fr-op-card__head">
        <Chip tone="muted">{INTEGRATION_CATEGORIES.find((c) => c.id === l.category)?.label ?? l.category}</Chip>
        <h2 className="fr-op-card__board">{l.name}</h2>
        <ListingChips status={l.status} featured={l.featured} />
        {l.openReports > 0 && <Chip tone="danger">{tr('openreportsOpenReports', { openReports: l.openReports })}</Chip>}
        <span className="fr-op-card__when" title={new Date(l.createdAt).toLocaleString()}>
          {relativeTime(l.createdAt, Date.now())}
        </span>
      </div>
      <p className="fr-op-listing__tagline">{l.tagline}</p>
      <dl className="fr-op-card__facts">
        <dt>{tr('submittedBy')}</dt>
        <dd>{l.submitter ? `${l.submitter.name} <${l.submitter.email}>` : tr('aDeletedAccount')}</dd>
        {l.contactEmail && (
          <>
            <dt>{tr('contact')}</dt>
            <dd>{l.contactEmail}</dd>
          </>
        )}
        <dt>{tr('website')}</dt>
        <dd>
          <a href={l.website} target="_blank" rel="noopener noreferrer nofollow">
            {l.website}
          </a>
        </dd>
        {l.docsUrl && (
          <>
            <dt>{tr('docs')}</dt>
            <dd>
              <a href={l.docsUrl} target="_blank" rel="noopener noreferrer nofollow">
                {l.docsUrl}
              </a>
            </dd>
          </>
        )}
        <dt>{tr('builtOn')}</dt>
        <dd>{l.builtOn.map((b) => LISTING_SURFACES.find((s) => s.id === b)?.label ?? b).join(', ')}</dd>
        <dt>{tr('oauthApp')}</dt>
        <dd>
          {l.oauthApp
            ? tr('nameClientidValueRedirectsTo', { name: l.oauthApp.name, clientId: l.oauthApp.clientId, value: l.oauthApp.website ? ` · ${l.oauthApp.website}` : '', redirectUris: l.oauthApp.redirectUris.join(', ') })
            : tr('noneNamed')}
        </dd>
        {l.statusNote && (
          <>
            <dt>{tr('lastDecision')}</dt>
            <dd>{l.statusNote}</dd>
          </>
        )}
      </dl>
      {l.description && <blockquote className="fr-op-card__message fr-op-listing__description">{l.description}</blockquote>}
      <div className="fr-op-card__actions">
        {(l.status === 'pending' || l.status === 'rejected') && (
          <Button size="sm" variant="primary" icon={Check} onClick={() => act('listing.approve')}>{tr('approve')}</Button>
        )}
        {l.status === 'pending' && (
          <Button size="sm" icon={X} onClick={() => act('listing.reject')}>{tr('decline')}</Button>
        )}
        {l.status === 'approved' && (
          <>
            <Button size="sm" icon={Star} onClick={() => act(l.featured ? 'listing.unfeature' : 'listing.feature')}>
              {l.featured ? tr('stopFeaturing') : tr('feature')}
            </Button>
            <Button size="sm" variant="danger" onClick={() => act('listing.remove')}>{tr('remove')}</Button>
          </>
        )}
        {l.status === 'removed' && (
          <Button size="sm" icon={ShieldCheck} onClick={() => act('listing.restore')}>{tr('restore')}</Button>
        )}
      </div>
    </article>
  );
}

function ActionDialog({ pending, onClose, onDone }: { pending: PendingAction; onClose: () => void; onDone: (a: ModerationActionRecord) => void }) {
  const adverse = ADVERSE.includes(pending.action);
  const needsReason = !NO_REASON.includes(pending.action);
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
      description={tr('forTargetlabelValueThisIs', { targetLabel: pending.targetLabel, value: pending.action === 'board.delete' ? tr('itsContentIsDeletedAnd') : '' })}
      width={500}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr('cancel')}</Button>
          <Button variant={adverse ? 'danger' : 'primary'} onClick={run} loading={busy} disabled={adverse && !statement.trim()}>
            {ACTION_LABEL[pending.action]}
          </Button>
        </>
      }
    >
      <div className="fr-op-form">
        {needsReason && (
          <>
            <label className="fr-op-form__label" htmlFor="fr-op-reason">{tr('reason')}</label>
            <Select<ReportReason> id="fr-op-reason" aria-label={tr('reason')} value={reason} onChange={setReason} options={REPORT_REASONS.map((r) => ({ value: r.id, label: r.label }))} />
          </>
        )}
        {pending.action === 'user.suspend' && (
          <>
            <label className="fr-op-form__label" htmlFor="fr-op-boards">{tr('theirBoards')}</label>
            <Select<SuspensionBoards | 'keep'>
              id="fr-op-boards"
              aria-label={tr('theirBoards')}
              value={boards}
              onChange={setBoards}
              options={[
                { value: 'keep', label: tr('leaveThemAsTheyAre') },
                { value: 'take_down', label: tr('takeDownEveryBoardThey') },
                { value: 'disable_link', label: tr('turnOffTheLinkOf') },
              ]}
            />
            <p className="fr-op-form__hint">{tr('eachBoardIsRecordedAs')}</p>
          </>
        )}
        <TextArea
          label={adverse ? tr('statementToThePersonAffected') : tr('messageToThePersonAffected')}
          hint={tr('sentByEmailWithThe')}
          value={statement}
          rows={4}
          maxLength={2000}
          onChange={(e) => setStatement(e.target.value)}
        />
        <TextArea label={tr('internalNoteOperatorsOnly')} value={note} rows={2} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
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
    <Modal open onClose={onClose} title={data ? tr('historyOfTitle', { title: data.board.title }) : tr('history')} width={560}>
      {error ? (
        <p className="fr-op-form__error">{error}</p>
      ) : !data ? (
        <Spinner size={20} label={tr('loading')} />
      ) : (
        <div className="fr-op-history">
          <h3>{tr('actions')}</h3>
          {data.actions.length === 0 ? (
            <p className="fr-op__empty">{tr('noActionsYet')}</p>
          ) : (
            <ul>
              {data.actions.map((a) => (
                <li key={a.id}>
                  <strong>{ACTION_LABEL[a.action]}</strong> · {reasonLabel(a.reason)} · {new Date(a.createdAt).toLocaleString()}
                  {a.operator ? ` · ${a.operator.name}` : ''}
                  {a.subject && <div className="fr-op-history__note">About {a.subject.name} &lt;{a.subject.email}&gt;</div>}
                  {a.statement && <div className="fr-op-history__text">“{a.statement}”</div>}
                  {a.note && <div className="fr-op-history__note">{tr('noteNote', { note: a.note })}</div>}
                </li>
              ))}
            </ul>
          )}
          <h3>{tr('reportsAndAppeals')}</h3>
          <ul>
            {data.items.map((i) => (
              <li key={i.id}>
                <strong>{i.kind === 'appeal' ? tr('appeal') : reasonLabel(i.reason)}</strong> · {i.status} · {new Date(i.createdAt).toLocaleString()}
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
      <h2>{tr('account')}</h2>
      <form
        className="fr-op-tool__row"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <Input aria-label={tr('emailAddress')} placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button size="sm" icon={Search} type="submit" disabled={!email.trim()}>{tr('find')}</Button>
      </form>
      {error && <p className="fr-op-form__error">{error}</p>}
      {user && (
        <div className="fr-op-tool__result">
          <span>
            {user.name} &lt;{user.email}&gt; {user.suspended && <Chip tone="danger">{tr('suspended')}</Chip>}
          </span>
          <Button
            size="sm"
            variant={user.suspended ? 'secondary' : 'danger'}
            onClick={() => onAct({ action: user.suspended ? 'user.restore' : 'user.suspend', targetId: user.id, targetLabel: `${user.name} <${user.email}>`, reason: 'spam' })}
          >
            {user.suspended ? tr('liftSuspension') : tr('suspend')}
          </Button>
        </div>
      )}
    </section>
  );
}

/** The Teams app and Copilot agent packages this instance offers (set up with environment variables). */
function MicrosoftPackages() {
  const [info, setInfo] = useState<MicrosoftIntegrationsInfo | null>(null);
  useEffect(() => void api.microsoftIntegrations().then(setInfo, () => setInfo({ teams: null, copilot: null })), []);
  return (
    <section className="fr-op-tool">
      <h2>{tr('microsoft365Apps')}</h2>
      {!info ? (
        <Spinner size={18} label={tr('loading')} />
      ) : (
        <div className="fr-op-tool__result">
          {info.teams ? (
            <a className="fr-op-card__file" href={info.teams.packageUrl} download>{tr('teamsAppPackage')}{info.teams.linkPreviews ? tr('withLinkPreviews') : ''}
            </a>
          ) : (
            <span>{tr('teamsAppOffSetTeams')}</span>
          )}
          {info.copilot ? (
            <a className="fr-op-card__file" href={info.copilot.packageUrl} download>{tr('copilotAgentPackage')}</a>
          ) : (
            <span>{tr('copilotAgentOffSetCopilot')}</span>
          )}
          <span>{tr('uploadThemInTheTeams')}</span>
        </div>
      )}
    </section>
  );
}

/** What this instance offers for Confluence and Jira, Zoom and Google Meet (#166–#169), each turned on by its id. */
function OtherPlatformApps() {
  const [info, setInfo] = useState<{ atlassian: HostAppInfo; zoom: HostAppInfo; meet: HostAppInfo } | null>(null);
  useEffect(() => {
    const off: HostAppInfo = { on: false, packageUrl: null };
    void Promise.all([api.hostApp('atlassian').catch(() => off), api.hostApp('zoom').catch(() => off), api.meetAddOn().catch(() => off)]).then(([atlassian, zoom, meet]) => setInfo({ atlassian, zoom, meet }));
  }, []);
  const entry = (app: HostAppInfo, label: string, off: string) =>
    app.packageUrl ? (
      <a className="fr-op-card__file" href={app.packageUrl} download>{label}</a>
    ) : (
      <span>{off}</span>
    );
  return (
    <section className="fr-op-tool">
      <h2>{tr('otherPlatformApps')}</h2>
      {!info ? (
        <Spinner size={18} label={tr('loading')} />
      ) : (
        <div className="fr-op-tool__result">
          {entry(info.atlassian, tr('atlassianAppSource'), tr('atlassianAppOff'))}
          {entry(info.zoom, tr('zoomAppSettings'), tr('zoomAppOff'))}
          {entry(info.meet, tr('meetDeployment'), tr('meetAddOnOff'))}
          <span>{tr('registerThemWithEach')}</span>
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
      <h2>{tr('uploadedFile')}</h2>
      <form
        className="fr-op-tool__row"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <Input aria-label={tr('fileUrlOrName')} placeholder="/uploads/…" value={name} onChange={(e) => setName(e.target.value)} />
        <Button size="sm" icon={Search} type="submit" disabled={!name.trim()}>{tr('find')}</Button>
      </form>
      {error && <p className="fr-op-form__error">{error}</p>}
      {upload && (
        <div className="fr-op-tool__result">
          <span>
            {upload.name} · {upload.owner ? upload.owner.email : tr('noOwner')} {upload.removedAt !== null && <Chip tone="danger">{tr('removed')}</Chip>}
          </span>
          {(upload.removedAt === null || upload.restorable) && (
            <a className="fr-op-card__file" href={api.moderationUploadFileUrl(upload.name)} download>{tr('downloadToReview')}</a>
          )}
          <span className="fr-op-chips">
            {upload.removedAt === null ? (
              <Button size="sm" variant="danger" onClick={() => onAct({ action: 'upload.remove', targetId: upload.name, targetLabel: `file ${upload.name}`, reason: 'illegal' })}>{tr('remove')}</Button>
            ) : upload.restorable ? (
              <>
                <Button size="sm" onClick={() => onAct({ action: 'upload.restore', targetId: upload.name, targetLabel: `file ${upload.name}`, reason: 'other' })}>{tr('restore')}</Button>
                <Button size="sm" variant="ghost" onClick={() => onAct({ action: 'upload.purge', targetId: upload.name, targetLabel: `file ${upload.name}`, reason: 'illegal' })}>{tr('deleteKeptCopy')}</Button>
              </>
            ) : null}
          </span>
        </div>
      )}
    </section>
  );
}

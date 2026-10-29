// Route /doc/:id (KAI-162) — a doc: its summary (the same container rules as a board: sharing,
// members, link, trash, request access), its live document (engine useObjectDoc + DocEditor), the
// comments on its blocks, version history, Markdown in and out, and live board embeds.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, FileUp, History, MessageSquare, MessageSquarePlus, MoreHorizontal, Share2 } from 'lucide-react';
import { DOC_MAX_IMPORT_CHARS, LINK_PASSWORD_REQUIRED, parseObjectUri, type BoardSummary } from '@freero/shared';
import { DocEditor, useObjectDoc, useObjectDocState, type DocHandle } from '@engine';
import { AvatarStack, Button, IconButton, Input, Logo, Menu, Modal, useToast } from '@ui';
import { api, ApiError, wsBase } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { FullPageSpinner } from '../../components/FullPageSpinner';
import { ShareDialog } from '../../components/ShareDialog';
import { LinkPassword } from '../../board/LinkPassword';
import { RequestAccess } from '../../board/RequestAccess';
import { loginPath } from '../../lib/nav';
import { NotificationBell } from '../../notifications/NotificationBell';
import { docsFrom } from '../../hostServices';
import { DocComments } from './DocComments';
import { DocHistory } from './DocHistory';
import '../../board/BoardPage.css';
import './doc.css';

// The live board embed pulls in the board engine and every board feature: loaded with the first embed.
const BoardEmbed = lazy(() => import('./BoardEmbed'));

type Load = { status: 'loading' } | { status: 'ready'; doc: BoardSummary } | { status: 'error'; code: number; message: string; reason?: string };

export default function DocPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    api.getBoard(id).then(
      ({ board }) => {
        if (cancelled) return;
        // A board's id: its own page.
        if (board.kind !== 'doc') navigate(`/board/${encodeURIComponent(id)}`, { replace: true });
        else setState({ status: 'ready', doc: board });
      },
      (err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) return navigate(loginPath(`/doc/${id}`), { replace: true });
        setState({ status: 'error', code: err instanceof ApiError ? err.status : 0, message: err instanceof Error ? err.message : String(err), reason: err instanceof ApiError ? err.code : undefined });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, navigate, attempt]);

  if (state.status === 'error' && state.reason === LINK_PASSWORD_REQUIRED) return <LinkPassword unlock={(pw) => api.unlockBoardLink(id, pw)} onUnlocked={retry} />;
  if (state.status === 'error' && state.code === 403) return <RequestAccess boardId={id} onGranted={retry} kind="doc" />;
  if (state.status === 'error') return <DocError code={state.code} message={state.message} />;
  if (state.status === 'loading') return <FullPageSpinner label="Opening doc" />;
  return <DocView key={state.doc.id} initial={state.doc} />;
}

function DocError({ code, message }: { code: number; message: string }) {
  const navigate = useNavigate();
  const copy =
    code === 451
      ? { title: 'This doc was removed for review', body: 'Freero’s moderators took it down after a report.' }
      : code === 404
        ? { title: 'This doc does not exist', body: 'It may have been deleted, or the link is mistyped.' }
        : { title: "We couldn't open this doc", body: message || 'Check your connection and try again.' };
  return (
    <div className="fr-boarderror">
      <div className="fr-boarderror__card">
        <Logo size={36} />
        <h1>{copy.title}</h1>
        <p>{copy.body}</p>
        <div className="fr-boarderror__actions">
          <Button variant="primary" size="lg" onClick={() => navigate('/app')}>
            Back to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}

type Panel = 'comments' | 'history' | null;

function DocView({ initial }: { initial: BoardSummary }) {
  const navigate = useNavigate();
  const location = useLocation();
  const notify = useToast();
  const { user } = useAuth();
  const [doc, setDoc] = useState(initial);
  const [shareOpen, setShareOpen] = useState(() => new URLSearchParams(location.search).has('share'));
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const [panel, setPanel] = useState<Panel>(() => (params.get('thread') ? 'comments' : null));
  const [activeThread, setActiveThread] = useState<string | null>(() => params.get('thread'));
  const [draftBlock, setDraftBlock] = useState<string | null | undefined>(undefined);
  const [handle, setHandle] = useState<DocHandle | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [embedAsk, setEmbedAsk] = useState<((uri: string | null) => void) | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const store = useObjectDoc(doc.id, `${wsBase()}/ws/docs`);
  const live = useObjectDocState(store);
  // The server's word on this socket's role wins (a role changed while the doc is open).
  const role = live.role ?? doc.role;
  const canEdit = (role === 'owner' || role === 'editor') && live.status !== 'denied' && live.status !== 'removed';
  const canComment = canEdit || role === 'commenter';
  const docs = useMemo(() => docsFrom(null, navigate), [navigate]);

  // Deep links: ?block=<id> (search hits, backlinks) and ?thread=<id> (notifications).
  useEffect(() => {
    if (!handle || !live.synced) return;
    const block = params.get('block');
    const thread = params.get('thread');
    const target = block ?? (thread ? live.threads.find((t) => t.id === thread)?.blockId : null);
    if (target) handle.revealBlock(target);
    // Only once the doc is there; later edits must not jump the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, live.synced, params]);

  const peers = useMemo(() => {
    const seen = new Map<string, { id?: string; name: string; color: string; avatarUrl?: string | null }>();
    for (const p of live.peers) if (p.user.id !== user?.id) seen.set(p.user.id ?? String(p.clientId), p.user);
    return [...seen.values()];
  }, [live.peers, user?.id]);

  const rename = async (title: string) => {
    const t = title.trim();
    if (!t || t === doc.title) return;
    try {
      const { board } = await api.updateBoard(doc.id, { title: t });
      setDoc(board);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not rename the doc', 'error');
    }
  };

  const startComment = () => {
    setDraftBlock(handle?.currentBlockId() ?? null);
    setPanel('comments');
  };

  const importMarkdown = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !handle) return;
    const text = await file.text();
    if (text.length > DOC_MAX_IMPORT_CHARS) return notify('That file is too large to import.', 'error');
    handle.insertMarkdown(text);
    notify(`Imported ${file.name}`, 'success');
  };

  const exportMarkdown = async () => {
    try {
      await docs.exportMarkdown(doc.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not export the doc', 'error');
    }
  };

  const pickBoardEmbed = useCallback(() => new Promise<string | null>((resolve) => setEmbedAsk(() => resolve)), []);
  const renderBoardEmbed = useCallback(
    (uri: string) => (
      <Suspense fallback={<div className="fr-docpage-embed fr-docpage-embed--loading" />}>
        <BoardEmbed uri={uri} />
      </Suspense>
    ),
    [],
  );
  const uploadImage = useCallback(async (file: File) => (await api.uploadImage(file)).url, []);
  const commentedBlocks = useMemo(() => live.threads.filter((t) => !t.resolved && t.blockId).map((t) => t.blockId!), [live.threads]);
  const activeBlock = activeThread ? (live.threads.find((t) => t.id === activeThread)?.blockId ?? null) : null;
  const openThreads = live.threads.filter((t) => !t.resolved).length;

  if (!user) return <FullPageSpinner label="Opening doc" />;
  return (
    <div className="fr-docpage">
      <header className="fr-docpage-top">
        <IconButton icon={ArrowLeft} label="Back to dashboard" onClick={() => navigate('/app')} />
        <span className="fr-docpage-wide">
          <Logo size={24} />
        </span>
        <input
          key={doc.title}
          className="fr-docpage-title"
          defaultValue={doc.title}
          aria-label="Doc title"
          readOnly={!canEdit}
          onBlur={(e) => void rename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="fr-docpage-status" aria-live="polite">
          {live.status === 'denied' ? 'No access' : live.status === 'removed' ? 'Removed for review' : live.status === 'connected' ? (canEdit ? '' : role === 'commenter' ? 'Can comment' : 'View only') : 'Connecting…'}
        </span>
        <div className="fr-docpage-spacer" />
        {peers.length > 0 && <AvatarStack className="fr-docpage-wide" users={peers} max={5} size={28} />}
        {canComment && <IconButton icon={MessageSquarePlus} label="Comment on this block" onClick={startComment} />}
        <IconButton icon={MessageSquare} label="Comments" active={panel === 'comments'} onClick={() => setPanel((p) => (p === 'comments' ? null : 'comments'))}>
          {openThreads > 0 && <span className="fr-docpage-badge">{openThreads}</span>}
        </IconButton>
        {canEdit && <IconButton className="fr-docpage-wide" icon={History} label="Version history" active={panel === 'history'} onClick={() => setPanel((p) => (p === 'history' ? null : 'history'))} />}
        <IconButton icon={MoreHorizontal} label="More" onClick={(e) => setMenuAnchor(e.currentTarget)} />
        <Menu
          open={!!menuAnchor}
          anchor={menuAnchor}
          onClose={() => setMenuAnchor(null)}
          items={[
            { id: 'export', label: 'Export as Markdown', icon: Download, onSelect: () => void exportMarkdown(), disabled: doc.permissions.canExport === false, disabledReason: 'This workspace doesn’t allow exports' },
            { id: 'import', label: 'Import Markdown…', icon: FileUp, onSelect: () => fileRef.current?.click(), disabled: !canEdit, disabledReason: 'Only editors can import' },
          ]}
        />
        <input ref={fileRef} type="file" accept=".md,.markdown,text/markdown,text/plain" hidden onChange={(e) => void importMarkdown(e)} />
        <span className="fr-docpage-wide">
          <NotificationBell size={40} />
        </span>
        <Button variant="primary" icon={Share2} onClick={() => setShareOpen(true)} aria-label="Share">
          <span className="fr-docpage-wide">Share</span>
        </Button>
      </header>
      <div className="fr-docpage-body">
        <main className="fr-docpage-main">
          {store ? (
            <article className="fr-docpage-paper">
              <DocEditor
                doc={store}
                user={{ name: user.name, color: user.color }}
                editable={canEdit}
                onReady={setHandle}
                renderBoardEmbed={renderBoardEmbed}
                uploadImage={uploadImage}
                pickBoardEmbed={canEdit ? pickBoardEmbed : undefined}
                commentedBlocks={commentedBlocks}
                activeBlock={activeBlock}
                label={doc.title}
              />
            </article>
          ) : null}
        </main>
        {panel === 'comments' && store && (
          <DocComments
            docId={doc.id}
            store={store}
            threads={live.threads}
            me={{ id: user.id, name: user.name, color: user.color }}
            canComment={canComment && live.status !== 'denied'}
            draftBlock={draftBlock}
            onDraftDone={() => setDraftBlock(undefined)}
            active={activeThread}
            onActivate={(t) => {
              setActiveThread(t?.id ?? null);
              if (t?.blockId) handle?.revealBlock(t.blockId);
            }}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === 'history' && <DocHistory docId={doc.id} onClose={() => setPanel(null)} renderBoardEmbed={renderBoardEmbed} />}
      </div>
      <ShareDialog
        boardId={doc.id}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        board={doc}
        onBoardChange={setDoc}
        onLeft={() => navigate('/app')}
      />
      <BoardEmbedPicker
        open={!!embedAsk}
        onDone={(uri) => {
          embedAsk?.(uri);
          setEmbedAsk(null);
        }}
      />
    </div>
  );
}

/** Asks for the board (or frame) to embed live: its link, as copied from the board. */
function BoardEmbedPicker({ open, onDone }: { open: boolean; onDone: (uri: string | null) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setValue('');
      setError(null);
    }
  }, [open]);
  const submit = () => {
    const ref = parseObjectUri(value, [window.location.origin]);
    if (ref?.type === 'board') return onDone(`freero://board/${ref.id}`);
    if (ref?.type === 'element') return onDone(`freero://board/${ref.boardId}#${ref.id}`);
    setError('Paste the link of a board, or of a frame on it (Copy link to item).');
  };
  return (
    <Modal
      open={open}
      onClose={() => onDone(null)}
      title="Embed a live board"
      description="It stays up to date. Each reader sees it only if they can open the board."
      footer={
        <>
          <Button onClick={() => onDone(null)}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            Embed
          </Button>
        </>
      }
    >
      <Input
        autoFocus
        aria-label="Board or frame link"
        placeholder="https://…/board/…?item=…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      {error && <p className="fr-docpage-error">{error}</p>}
    </Modal>
  );
}

// A doc on the board (KAI-124, KAI-152): the SAME object as the doc's own page — the board stores
// only its address and shows it LIVE from the doc's own Yjs document and socket. The server admits
// that socket with the viewer's access to THE DOC, so someone who can't open it sees a "No access"
// card (with a way to ask), whatever their role on the board. Double-click edits it in place (an
// editor of the doc); "Open" takes it full page. Undo on the board never touches the doc's text
// (its own document and history), and the other way round.
import { memo, useEffect, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { ExternalLink, FileText, Lock, PencilLine } from 'lucide-react';
import type { DocElement, ResolvedObject } from '@freero/shared';
import {
  DocEditor,
  LiveBoardView,
  defineElement,
  useEditor,
  useIsExporting,
  useObjectDoc,
  useObjectDocState,
  useSelection,
  type Editor,
  type ElementRenderProps,
  type LiveBoardStatus,
  type NewElement,
} from '@engine';
import { docIdOf, getEditingDoc, resolveDoc, setEditingDoc, subscribeEditingDoc } from './lib/state';
import { createDocFrom, isMarkdownFile, looksLikeMarkdownDoc } from './lib/create';
import './doc.css';

export const DOC_W = 560;
export const DOC_H = 640;
/** Below this zoom the doc is a card: no live connection for docs too small to read. */
const LIVE_ZOOM = 0.3;

const stop = (e: MouseEvent | PointerEvent) => e.stopPropagation();

/** A live board embedded INSIDE the doc, drawn with this board's own element definitions. */
function NestedBoard({ uri }: { uri: string }) {
  const m = /^freero:\/\/board\/([\w-]{1,64})(?:#([\w-]{1,64}))?$/.exec(uri);
  const [status, setStatus] = useState<LiveBoardStatus>('connecting');
  if (!m) return null;
  if (status === 'denied' || status === 'removed')
    return (
      <div className="fr-doc-item__nested fr-doc-item__nested--blocked">
        <Lock size={16} aria-hidden /> No access to this board
      </div>
    );
  return (
    <div className="fr-doc-item__nested">
      <LiveBoardView boardId={m[1]} frameId={m[2] ?? null} onStatus={setStatus} />
    </div>
  );
}

function useResolved(editor: Editor, uri: string, enabled: boolean): ResolvedObject | null {
  const [res, setRes] = useState<ResolvedObject | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void resolveDoc(editor, uri).then((r) => live && setRes(r));
    return () => {
      live = false;
    };
  }, [editor, uri, enabled]);
  return res;
}

/** The live document (mounted only while the item is big enough to read). */
function LiveDoc({ el, editor, title }: { el: DocElement; editor: Editor; title: string }) {
  const docs = editor.host.docs!;
  const id = docIdOf(el.uri)!;
  const store = useObjectDoc(id, docs.syncUrl);
  const state = useObjectDocState(store);
  const editingId = useSyncExternalStore(subscribeEditingDoc, getEditingDoc);
  const selection = useSelection();
  const canEditDoc = (state.role === 'owner' || state.role === 'editor') && state.status !== 'denied';
  const editing = editingId === el.id && canEditDoc;

  // Editing ends when the item is no longer selected (a click elsewhere on the board).
  useEffect(() => {
    if (editingId === el.id && !selection.includes(el.id)) setEditingDoc(null);
  }, [editingId, selection, el.id]);

  if (state.status === 'denied' || state.status === 'removed') return <NoAccess editor={editor} id={id} removed={state.status === 'removed'} />;
  const user = editor.host.user;
  return (
    <div
      className={`fr-doc-item__body${editing ? ' is-editing' : ''}`}
      // While editing, pointer and wheel go to the document (it scrolls), not the board.
      {...(editing ? { 'data-fr-interactive': '', 'data-fr-scrollable': '' } : {})}
      onPointerDown={editing ? stop : undefined}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          setEditingDoc(null);
        }
      }}
    >
      {store && (
        <DocEditor
          doc={store}
          user={{ name: user.name, color: user.color }}
          editable={editing}
          label={title}
          uploadImage={async (file) => (await editor.host.uploadImage(file)).url}
          renderBoardEmbed={(uri) => <NestedBoard uri={uri} />}
        />
      )}
    </div>
  );
}

function NoAccess({ editor, id, removed }: { editor: Editor; id: string; removed?: boolean }) {
  return (
    <div className="fr-doc-item__denied">
      <Lock size={28} aria-hidden />
      <strong>{removed ? 'This doc was removed for review' : 'No access to this doc'}</strong>
      {!removed && <span>Its owner hasn’t shared it with you.</span>}
      {!removed && editor.host.docs && (
        <button type="button" className="fr-doc-item__btn" data-fr-interactive="" onPointerDown={stop} onClick={() => editor.host.docs!.requestAccess(id)}>
          Request access
        </button>
      )}
    </div>
  );
}

const DocView = memo(function DocView({ element: el, zoom }: ElementRenderProps<DocElement>) {
  const editor = useEditor();
  const exporting = useIsExporting();
  const id = docIdOf(el.uri);
  // Inside a board that is itself embedded live (a doc's board embed), a card: embeds never nest without end.
  const live = !exporting && !!id && !!editor.host.docs && !editor.host.board.embedded;
  const res = useResolved(editor, el.uri, live);
  const title = res?.status === 'ok' ? res.object.title || 'Untitled doc' : 'Doc';
  const denied = res?.status === 'unavailable' || res?.status === 'invalid';
  const editingId = useSyncExternalStore(subscribeEditingDoc, getEditingDoc);

  return (
    <div className={`fr-doc-item${denied ? ' is-denied' : ''}`} style={{ width: el.w, height: el.h }}>
      <div className="fr-doc-item__bar">
        <FileText size={16} aria-hidden />
        <span className="fr-doc-item__title">{exporting || !live ? 'Doc' : title}</span>
        {live && !denied && res?.status === 'ok' && (
          <>
            {editingId !== el.id && res.object.access !== 'view' && res.object.access !== 'comment' && (
              <button type="button" className="fr-doc-item__icon" data-fr-interactive="" aria-label="Edit here" title="Edit here" onPointerDown={stop} onClick={() => (editor.select([el.id]), setEditingDoc(el.id))}>
                <PencilLine size={15} />
              </button>
            )}
            <button type="button" className="fr-doc-item__icon" data-fr-interactive="" aria-label="Open the doc" title="Open the doc" onPointerDown={stop} onClick={() => editor.host.navigate(res.object.path ?? `/doc/${id}`)}>
              <ExternalLink size={15} />
            </button>
          </>
        )}
      </div>
      {!live ? (
        <div className="fr-doc-item__card">A Freero doc</div>
      ) : denied ? (
        <NoAccess editor={editor} id={id!} />
      ) : res?.status === 'ok' && zoom >= LIVE_ZOOM ? (
        <LiveDoc el={el} editor={editor} title={title} />
      ) : (
        <div className="fr-doc-item__card">{res ? title : 'Loading…'}</div>
      )}
    </div>
  );
});

export default defineElement<'doc'>({
  type: 'doc',
  label: { one: 'Doc', many: 'Docs' },
  icon: FileText,
  resize: 'free',
  minSize: { w: 240, h: 160 },
  defaults: (): Omit<NewElement<'doc'>, 'x' | 'y'> => ({ type: 'doc', w: DOC_W, h: DOC_H, uri: '' }),
  Component: DocView,
  // The address only: the doc's text is the doc's, read from it by those who may (never copied here).
  toPlainText: (el) => el.uri,
  onDoubleClick(el, { editor }) {
    if (docIdOf(el.uri) && editor.host.docs) {
      editor.select([el.id]);
      setEditingDoc(el.id);
    }
  },

  // Markdown files and pasted Markdown with headings become a doc; a pasted doc address shows that
  // doc live. Ahead of the mind map (25), smart links (11), PDFs (15) and other files (12).
  importPriority: 30,
  importData(editor, data, at) {
    if (!editor.host.docs) return false;
    const md = data.files.filter(isMarkdownFile);
    if (md.length) {
      void (async () => {
        let i = 0;
        for (const f of md) await createDocFrom(editor, { markdown: await f.text(), title: f.name.replace(/\.(md|markdown)$/i, '') }, { x: at.x + i * 40, y: at.y + i++ * 40 });
      })();
      return md.length === data.files.length ? true : md;
    }
    if (data.files.length) return false;
    const text = data.text ?? '';
    const pasted = text.trim();
    const linked = /^https?:\/\//.test(pasted) || pasted.startsWith('freero://') ? pastedDocUri(pasted) : null;
    if (linked) {
      editor.create<'doc'>({ type: 'doc', uri: linked, x: Math.round(at.x - DOC_W / 2), y: Math.round(at.y - DOC_H / 2), w: DOC_W, h: DOC_H }, { select: true });
      return true;
    }
    if (!looksLikeMarkdownDoc(text)) return false;
    void createDocFrom(editor, { markdown: text }, at);
    return true;
  },
});

/** A pasted doc address (`freero://doc/<id>` or this app's `/doc/<id>` URL), as its canonical form. */
function pastedDocUri(text: string): string | null {
  if (/\s/.test(text)) return null;
  const direct = docIdOf(text);
  if (direct) return `freero://doc/${direct}`;
  try {
    const url = new URL(text);
    if (url.origin !== window.location.origin) return null;
    const m = /^\/doc\/([A-Za-z0-9_-]{1,64})\/?$/.exec(url.pathname);
    return m ? `freero://doc/${m[1]}` : null;
  } catch {
    return null;
  }
}

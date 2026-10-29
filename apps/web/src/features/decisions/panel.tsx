// Decision snapshots on the board: freezing the board or a frame (a dialog) and the board's
// decisions (a dock panel). Opening one goes to its own read-only page, /decision/<id>.
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Link2, Stamp, Trash2 } from 'lucide-react';
import { MAX_DECISION_NOTE, MAX_DECISION_TITLE, type Decision, type FrameElement } from '@freero/shared';
import { DockHeader, definePanel, type Editor, type PanelProps } from '@engine';
import { Button, IconButton, Input, Modal, Spinner, TextArea } from '@ui';
import { CREATE_ID, LIST_ID } from './lib/ids';
import './decisions.css';

const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong');
const decisionUrl = (id: string) => `${window.location.origin}/decision/${encodeURIComponent(id)}`;

// The list is read again after this tab freezes or deletes one (decisions don't live in the board doc).
let revision = 0;
const listeners = new Set<() => void>();
const changed = () => {
  revision++;
  for (const l of [...listeners]) l();
};

function useDecisions(editor: Editor): { list: Decision[] | null; error: string | null } {
  const [rev, setRev] = useState(revision);
  const [list, setList] = useState<Decision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const l = () => setRev(revision);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  useEffect(() => {
    let live = true;
    editor.host.decisions?.list().then(
      (d) => live && (setList(d), setError(null)),
      (e: unknown) => live && setError(message(e)),
    );
    return () => {
      live = false;
    };
  }, [editor, rev]);
  return { list, error };
}

function CreateDialog({ editor, props }: PanelProps) {
  const frameId = typeof props?.frameId === 'string' ? props.frameId : null;
  const frame = frameId ? (editor.getElement(frameId) as FrameElement | undefined) : undefined;
  const subject = frame ? frame.title || 'Untitled frame' : editor.host.board.title || 'Board';
  const [title, setTitle] = useState(`${subject} decision, ${new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(Date.now())}`.slice(0, MAX_DECISION_TITLE));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => editor.closePanel(CREATE_ID);
  const freeze = async () => {
    if (!editor.host.decisions || !title.trim()) return;
    setBusy(true);
    try {
      const d = await editor.host.decisions.create({ title: title.trim(), note: note.trim(), ...(frameId ? { frameId } : {}) });
      changed();
      close();
      editor.host.notify(`Frozen “${d.title}”`, 'success', { action: { label: 'Open', run: () => editor.host.navigate(`/decision/${d.id}`) } });
    } catch (e) {
      editor.host.notify(message(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={close}
      title={frame ? `Freeze “${subject}” for a decision` : 'Freeze the board for a decision'}
      description="A read-only copy of exactly what’s here now, with its own link to cite in tickets and docs. Later edits never change it. Everyone who can open this board can see it; hidden frames and private drafts are never included."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" icon={Stamp} loading={busy} disabled={!title.trim()} onClick={() => void freeze()}>
            Freeze
          </Button>
        </>
      }
    >
      <div className="fr-decisions-create">
        <Input label="Decision" value={title} maxLength={MAX_DECISION_TITLE} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <TextArea label="Note (optional)" rows={3} value={note} maxLength={MAX_DECISION_NOTE} placeholder="What was decided, and by whom" onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

function ListPanel({ editor }: PanelProps) {
  const { list, error } = useDecisions(editor);
  const [deleting, setDeleting] = useState<Decision | null>(null);
  const copy = useCallback(
    async (d: Decision) => {
      try {
        await navigator.clipboard.writeText(decisionUrl(d.id));
        editor.host.notify('Link copied', 'success');
      } catch {
        editor.host.notify(decisionUrl(d.id), 'info');
      }
    },
    [editor],
  );
  const remove = async () => {
    const d = deleting;
    setDeleting(null);
    if (!d) return;
    try {
      await editor.host.decisions?.remove(d.id);
      changed();
      editor.host.notify(`Deleted “${d.title}”. Its version stays in the version history.`, 'success');
    } catch (e) {
      editor.host.notify(message(e), 'error');
    }
  };
  return (
    <div className="fr-decisions">
      <DockHeader className="fr-decisions__head">
        <h2 className="fr-decisions__title">Decisions</h2>
      </DockHeader>
      {editor.can('editor') && (
        <Button variant="primary" icon={Stamp} onClick={() => editor.openPanel(CREATE_ID, {})}>
          Freeze the board for a decision
        </Button>
      )}
      {error && (
        <p className="fr-decisions__empty" role="alert">
          {error}
        </p>
      )}
      {!list && !error && <Spinner size={18} />}
      {list && !list.length && <p className="fr-decisions__empty">No decisions yet. Freeze the board, or a frame (right-click it), when the group agrees on something.</p>}
      <ul className="fr-decisions__items">
        {list?.map((d) => (
          <li key={d.id} className="fr-decisions__item">
            <button type="button" className="fr-decisions__open" onClick={() => editor.host.navigate(`/decision/${d.id}`)} aria-label={`Open ${d.title}`}>
              <Stamp size={18} aria-hidden />
              <span className="fr-decisions__text">
                <span className="fr-decisions__name">{d.title}</span>
                <span className="fr-decisions__meta">
                  Frozen {day.format(d.createdAt)}
                  {d.createdBy ? ` by ${d.createdBy.name}` : ''}
                  {d.frameId ? ` · frame “${d.frameTitle || 'Untitled'}”` : ''}
                </span>
                {d.note && <span className="fr-decisions__note">{d.note}</span>}
              </span>
              <ExternalLink size={14} aria-hidden className="fr-decisions__go" />
            </button>
            <IconButton icon={Link2} size={32} label="Copy link" onClick={() => void copy(d)} />
            {editor.can('editor') && <IconButton icon={Trash2} size={32} label="Delete decision" onClick={() => setDeleting(d)} />}
          </li>
        ))}
      </ul>
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this decision?"
        description="Its link stops working for everyone. The board as it was stays in the version history."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}

export default [
  definePanel({ id: LIST_ID, slot: 'dock-right', order: 59, minRole: 'viewer', Component: ListPanel }),
  definePanel({ id: CREATE_ID, slot: 'dialog', order: 0, minRole: 'editor', Component: CreateDialog }),
];

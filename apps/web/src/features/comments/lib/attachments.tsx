// Files and images on comment messages (#143). They are uploaded as ATTACHMENTS (opaque bytes the
// server never serves at /uploads/) and fetched only from this board, through the host
// (`Host.commentFile`): pictures inline for anyone who can read the thread, other files as
// downloads, which the board's workspace may refuse (downloads policy).
import { useRef, useState } from 'react';
import { Download, FileText, Paperclip, X } from 'lucide-react';
import { COMMENT_MAX_ATTACHMENTS, type CommentAttachment } from '@freero/shared';
import type { CommentFileRef, Editor } from '@engine';
import { IconButton, Spinner } from '@ui';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

/** The files a composer is about to send, uploaded as soon as they are picked. */
export function useAttachDraft(editor: Editor) {
  const [items, setItems] = useState<CommentAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const can = !!editor.host.uploadAttachment && !!editor.host.commentFile;
  const add = async (files: File[]) => {
    const upload = editor.host.uploadAttachment;
    if (!upload) return;
    const room = COMMENT_MAX_ATTACHMENTS - items.length - uploading;
    if (files.length > room) editor.host.notify(`A comment carries at most ${COMMENT_MAX_ATTACHMENTS} files`, 'info');
    for (const file of files.slice(0, Math.max(0, room))) {
      setUploading((n) => n + 1);
      try {
        const { url } = await upload(file);
        const item: CommentAttachment = { src: url, name: file.name || 'file', size: file.size, ...(IMAGE_TYPES.has(file.type) ? { image: true } : {}) };
        setItems((list) => [...list, item]);
      } catch (e) {
        editor.host.notify(e instanceof Error && e.message ? e.message : 'Could not attach the file', 'error');
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  return { items, uploading, can, add, remove: (i: number) => setItems((list) => list.filter((_, j) => j !== i)), clear: () => setItems([]) };
}

export type AttachDraft = ReturnType<typeof useAttachDraft>;

/** The paperclip: picks files to attach. */
export function AttachButton({ draft }: { draft: AttachDraft }) {
  const input = useRef<HTMLInputElement>(null);
  if (!draft.can) return null;
  return (
    <>
      <IconButton icon={Paperclip} label="Attach a file or image" size={32} disabled={draft.items.length + draft.uploading >= COMMENT_MAX_ATTACHMENTS} onClick={() => input.current?.click()} />
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          void draft.add(files);
        }}
      />
    </>
  );
}

/** What is about to be sent, removable. */
export function PendingAttachments({ draft }: { draft: AttachDraft }) {
  if (!draft.items.length && !draft.uploading) return null;
  return (
    <ul className="fr-cm-files fr-cm-files--pending" aria-label="Attached files">
      {draft.items.map((a, i) => (
        <li key={a.src} className="fr-cm-file">
          <FileText size={14} aria-hidden />
          <span className="fr-cm-file__name">{a.name}</span>
          <span className="fr-cm-file__size">{size(a.size)}</span>
          <IconButton icon={X} label={`Remove ${a.name}`} size={32} onClick={() => draft.remove(i)} />
        </li>
      ))}
      {draft.uploading ? (
        <li className="fr-cm-file">
          <Spinner size={14} /> <span className="fr-cm-file__name">Uploading…</span>
        </li>
      ) : null}
    </ul>
  );
}

/** A sent message's files: pictures shown in the thread, everything downloadable from the board. */
export function MessageAttachments({ editor, files, at }: { editor: Editor; files: CommentAttachment[]; at: Omit<CommentFileRef, 'index'> }) {
  const host = editor.host.commentFile;
  if (!files.length) return null;
  const download = (a: CommentAttachment, index: number) =>
    host
      ?.download({ ...at, index, name: a.name })
      .catch((e: unknown) => editor.host.notify(e instanceof Error && e.message ? e.message : 'Could not download the file', 'error'));
  return (
    <ul className="fr-cm-files" aria-label="Files">
      {files.map((a, index) => (
        <li key={`${a.src}-${index}`} className={`fr-cm-file${a.image && host ? ' fr-cm-file--image' : ''}`}>
          {a.image && host ? (
            <img className="fr-cm-file__img" src={host.imageUrl({ ...at, index })} alt={a.name} loading="lazy" draggable={false} />
          ) : (
            <FileText size={14} aria-hidden />
          )}
          <span className="fr-cm-file__name">{a.name}</span>
          <span className="fr-cm-file__size">{size(a.size)}</span>
          {host ? <IconButton icon={Download} label={`Download ${a.name}`} size={32} onClick={() => void download(a, index)} /> : null}
        </li>
      ))}
    </ul>
  );
}

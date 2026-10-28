// Full-screen, read-only preview of one version (a dialog panel). The board shown is a separate
// local session (<StaticBoardView>): panning it or stepping through versions never changes the
// live board, and collaborators see nothing of it. "Restore" asks first, then restores for everyone.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react';
import { StaticBoardView, type PanelProps } from '@engine';
import { Button, IconButton, Modal, Spinner } from '@ui';
import { PREVIEW_ID } from './ids';
import { formatWhen, restoreVersion, useVersions, versionByline, versionTitle } from './versions';

export function Preview({ editor, props }: PanelProps) {
  const ids = (props?.ids as number[] | undefined) ?? [];
  const [id, setId] = useState(Number(props?.id));
  const { versions } = useVersions(editor);
  const version = versions?.find((v) => v.id === id) ?? null;
  const [state, setState] = useState<{ id: number; bytes: Uint8Array } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const cache = useRef(new Map<number, Uint8Array>());
  const root = useRef<HTMLDivElement>(null);
  const close = () => editor.closePanel(PREVIEW_ID);

  // Focus inside the dialog: the live board's keyboard ignores keys typed here (no shortcut
  // reaches the board under the preview).
  useLayoutEffect(() => root.current?.focus(), []);
  // Escape closes, wherever focus went (a button that just became disabled drops it to <body>).
  const confirmingRef = useRef(confirming);
  confirmingRef.current = confirming;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The preview is modal: keys typed with focus nowhere in particular must not reach the live
      // board's shortcuts underneath (Delete would delete its selection).
      if (e.target === document.body) e.stopPropagation();
      if (e.key !== 'Escape' || confirmingRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      editor.closePanel(PREVIEW_ID);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editor]);

  useEffect(() => {
    let alive = true;
    setFailed(null);
    const cached = cache.current.get(id);
    if (cached) {
      setState({ id, bytes: cached });
      return;
    }
    editor.host.versions.load(id).then(
      (bytes) => {
        cache.current.set(id, bytes);
        if (alive) setState({ id, bytes });
      },
      (e: unknown) => alive && setFailed(e instanceof Error ? e.message : 'This version could not be loaded'),
    );
    return () => {
      alive = false;
    };
  }, [editor, id]);

  const at = ids.indexOf(id);
  const older = at >= 0 && at + 1 < ids.length ? ids[at + 1] : null;
  const newer = at > 0 ? ids[at - 1] : null;
  const byline = version ? versionByline(version) : null;

  const restore = async () => {
    if (!version) return;
    setRestoring(true);
    const ok = await restoreVersion(editor, version);
    setRestoring(false);
    setConfirming(false);
    if (ok) close();
  };

  return (
    <div
      ref={root}
      className="fr-history-preview"
      role="dialog"
      aria-modal="true"
      aria-label="Version preview"
      tabIndex={-1}
    >
      <header className="fr-history-preview__bar">
        <IconButton icon={X} label="Close preview" onClick={close} />
        <div className="fr-history-preview__what">
          <strong>{version ? versionTitle(version) : 'Version'}</strong>
          <span>
            {version ? formatWhen(version.createdAt) : ''}
            {byline ? ` · ${byline}` : ''}
          </span>
        </div>
        <span className="fr-history-preview__badge">Preview · read-only</span>
        <div className="fr-history-preview__nav">
          <IconButton icon={ChevronLeft} label="Older version" disabled={older === null} onClick={() => older !== null && setId(older)} />
          <IconButton icon={ChevronRight} label="Newer version" disabled={newer === null} onClick={() => newer !== null && setId(newer)} />
        </div>
        <Button variant="primary" icon={RotateCcw} disabled={!version || !state} onClick={() => setConfirming(true)}>
          Restore this version
        </Button>
      </header>
      <div className="fr-history-preview__board">
        {state && <StaticBoardView key={state.id} state={state.bytes} label={version ? `${versionTitle(version)}, ${formatWhen(version.createdAt)}` : 'Version'} />}
        {(!state || state.id !== id) && !failed && (
          <div className="fr-history-preview__status">
            <Spinner size={22} />
          </div>
        )}
        {failed && (
          <div className="fr-history-preview__status" role="alert">
            {failed}
          </div>
        )}
      </div>
      <Modal
        open={confirming}
        onClose={() => !restoring && setConfirming(false)}
        title="Restore this version?"
        description="Everyone on the board sees it right away. The board as it is now is kept as a version, so you can undo this. Comments, votes and the timer stay as they are."
        footer={
          <>
            <Button variant="ghost" disabled={restoring} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={restoring} onClick={() => void restore()}>
              Restore
            </Button>
          </>
        }
      />
    </div>
  );
}

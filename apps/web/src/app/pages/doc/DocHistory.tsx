// Version history of a doc (KAI-162): the same versions as boards (realtime's snapshots: automatic,
// named, before-restore), previewed read-only from the version's own state (a local copy that never
// connects) and restored ON THE SERVER as a new change everyone converges on — comments stay.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { RotateCcw, X } from 'lucide-react';
import type { BoardVersion } from '@freero/shared';
import { DocEditor, useObjectDoc } from '@engine';
import { Button, IconButton, Input, Modal, Spinner, useToast } from '@ui';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';

const label = (v: BoardVersion) => v.name ?? (v.kind === 'before-restore' ? 'Before a restore' : 'Automatic version');
const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function Preview({ docId, version, onClose, onRestored, renderBoardEmbed }: { docId: string; version: BoardVersion; onClose(): void; onRestored(): void; renderBoardEmbed?: (uri: string) => ReactNode }) {
  const notify = useToast();
  const { user } = useAuth();
  const [state, setState] = useState<Uint8Array | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.versionState(docId, version.id).then(
      (s) => !cancelled && setState(s),
      (err) => notify(err instanceof Error ? err.message : 'Could not load that version', 'error'),
    );
    return () => {
      cancelled = true;
    };
  }, [docId, version.id, notify]);
  const store = useObjectDoc(state ? `preview-${version.id}` : null, '', state ?? undefined);
  const restore = async () => {
    setBusy(true);
    try {
      await api.restoreVersion(docId, version.id);
      notify('Version restored. The doc as it was is kept as a version too.', 'success');
      onRestored();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not restore that version', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={820}
      title={label(version)}
      description={when(version.createdAt)}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon={RotateCcw} loading={busy} onClick={() => void restore()}>
            Restore this version
          </Button>
        </>
      }
    >
      <div className="fr-dochistory-preview">{store && user ? <DocEditor doc={store} user={{ name: user.name, color: user.color }} editable={false} renderBoardEmbed={renderBoardEmbed} label={`Version: ${label(version)}`} /> : <Spinner />}</div>
    </Modal>
  );
}

/** `renderBoardEmbed`: embedded boards show live in a preview too (each reader's access to the board applies). */
export function DocHistory({ docId, onClose, renderBoardEmbed }: { docId: string; onClose(): void; renderBoardEmbed?: (uri: string) => ReactNode }) {
  const notify = useToast();
  const [versions, setVersions] = useState<BoardVersion[] | null>(null);
  const [preview, setPreview] = useState<BoardVersion | null>(null);
  const [name, setName] = useState('');
  const load = useCallback(() => {
    api.listVersions(docId).then(
      ({ versions: v }) => setVersions(v),
      (err) => notify(err instanceof Error ? err.message : 'Could not load the versions', 'error'),
    );
  }, [docId, notify]);
  useEffect(load, [load]);
  const nameCurrent = async () => {
    if (!name.trim()) return;
    try {
      await api.nameVersion(docId, name.trim());
      setName('');
      load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not keep this version', 'error');
    }
  };
  return (
    <aside className="fr-docpage-panel" aria-label="Version history">
      <header className="fr-docpage-panel__head">
        <h2>Version history</h2>
        <IconButton icon={X} label="Close version history" onClick={onClose} />
      </header>
      <div className="fr-docpage-panel__body">
        <form
          className="fr-dochistory-name"
          onSubmit={(e) => {
            e.preventDefault();
            void nameCurrent();
          }}
        >
          <Input placeholder="Name this version" aria-label="Name this version" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" size="sm" disabled={!name.trim()}>
            Keep
          </Button>
        </form>
        {!versions ? (
          <Spinner />
        ) : !versions.length ? (
          <p className="fr-docpage-empty">No versions yet. Freero keeps one automatically while people edit, and you can name the current one.</p>
        ) : (
          <ul className="fr-dochistory-list">
            {versions.map((v) => (
              <li key={v.id}>
                <button type="button" className="fr-dochistory-item" onClick={() => setPreview(v)}>
                  <strong>{label(v)}</strong>
                  <span>{when(v.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {preview && (
        <Preview
          docId={docId}
          renderBoardEmbed={renderBoardEmbed}
          version={preview}
          onClose={() => setPreview(null)}
          onRestored={() => {
            setPreview(null);
            load();
          }}
        />
      )}
    </aside>
  );
}

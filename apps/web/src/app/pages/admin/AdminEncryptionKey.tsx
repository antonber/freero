// The workspace's encryption key (#159; docs/design/compliance.md §3), for its security admins:
// turn a key on (the instance's, or the workspace's own AWS KMS key), rotate it, suspend / resume
// it, and — owners only, typing the workspace's name — destroy it. Every action is checked again by
// the server; destroying is irreversible and says so.
import { useEffect, useState } from 'react';
import type { WorkspaceKeyStatus, WorkspaceSummary } from '@freero/shared';
import { Button, Input, Modal, Spinner, useToast } from '@ui';
import { api, ApiError } from '../../api/client';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);
const when = (ms: number) => new Date(ms).toLocaleString();

const STATE: Record<NonNullable<WorkspaceKeyStatus['key']>['state'], { label: string; tone: 'ok' | 'warn' | 'off' }> = {
  active: { label: 'Active', tone: 'ok' },
  suspended: { label: 'Suspended', tone: 'off' },
  unavailable: { label: 'Unavailable', tone: 'warn' },
  destroyed: { label: 'Destroyed', tone: 'off' },
};

export function AdminEncryptionKey({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [status, setStatus] = useState<WorkspaceKeyStatus | null | undefined>(undefined);
  const [arn, setArn] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'suspend' | 'destroy' | null>(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    api.workspaceKey(workspace.id).then(setStatus, () => setStatus(null));
  }, [workspace.id]);

  const run = async (what: string, fn: () => Promise<WorkspaceKeyStatus>, done: string) => {
    setBusy(what);
    try {
      setStatus(await fn());
      setConfirm(null);
      setTyped('');
      notify(done, 'success');
    } catch (e) {
      notify(errorText(e, 'Something went wrong with the key'), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (status === undefined) return <Spinner />;
  if (!status || (!status.key && !status.providers.length)) return null; // this server offers no workspace keys
  const key = status.key;
  const kms = status.providers.includes('aws-kms');
  const owner = workspace.role === 'owner';

  return (
    <div className="fr-admin-card">
      <h2 className="fr-admin-card__title">Encryption key</h2>
      <p className="fr-admin-row__hint">
        Board content of this workspace — boards, their history and private drafts — is stored encrypted with a key only this workspace’s key opens.
        Suspending or revoking the key closes every board here until it is available again. Titles, members and the audit log are not encrypted
        with it.
      </p>
      {!key ? (
        <div className="fr-admin-key">
          {kms ? (
            <Input
              label="Your AWS KMS key (optional)"
              value={arn}
              onChange={(e) => setArn(e.target.value)}
              placeholder="arn:aws:kms:eu-west-1:111122223333:key/…"
              spellCheck={false}
            />
          ) : null}
          <p className="fr-admin-row__hint">
            {kms
              ? 'Leave it empty to use a key this server manages. With your own key, its key policy must let this server encrypt and decrypt with it; you can revoke that at any time.'
              : 'The key is managed by this server.'}
          </p>
          <div className="fr-admin-networks__actions">
            <Button
              variant="primary"
              size="sm"
              loading={busy === 'create'}
              onClick={() => void run('create', () => api.createWorkspaceKey(workspace.id, arn.trim() ? { kmsKeyId: arn.trim() } : {}), 'Encryption key on — existing boards are being encrypted')}
            >
              Turn on encryption key
            </Button>
          </div>
        </div>
      ) : (
        <div className="fr-admin-key">
          <div className="fr-admin-row">
            <div className="fr-admin-row__text">
              <span className="fr-admin-row__label">
                {key.provider === 'aws-kms' ? 'Your AWS KMS key' : 'Managed by this server'}{' '}
                <span className={`fr-admin-pill fr-admin-pill--${STATE[key.state].tone}`}>{STATE[key.state].label}</span>
              </span>
              <span className="fr-admin-row__hint">
                {key.kmsKeyId ? <code>{key.kmsKeyId}</code> : null}
                {key.kmsKeyId ? ' · ' : ''}
                Data key version {key.dataKeyVersion} · on since {when(key.createdAt)}
                {key.kekRotatedAt ? ` · rotated ${when(key.kekRotatedAt)}` : ''}
                {key.pendingBoards ? ` · ${key.pendingBoards} board${key.pendingBoards === 1 ? '' : 's'} still being encrypted` : ''}
              </span>
              {key.state === 'unavailable' && key.reason ? <span className="fr-admin-row__hint">The key service said: {key.reason}</span> : null}
              {key.state === 'destroyed' ? (
                <span className="fr-admin-row__hint">The data keys were destroyed {when(key.stateChangedAt)}. This workspace’s encrypted content can never be read again.</span>
              ) : null}
            </div>
          </div>
          {key.state !== 'destroyed' ? (
            <div className="fr-admin-networks__actions">
              {key.state === 'active' ? (
                <>
                  <Button size="sm" loading={busy === 'rotate'} onClick={() => void run('rotate', () => api.rotateWorkspaceKey(workspace.id, {}), 'Key rotated — new content uses a new data key')}>
                    Rotate key
                  </Button>
                  <Button size="sm" onClick={() => setConfirm('suspend')}>
                    Suspend
                  </Button>
                </>
              ) : null}
              {key.state === 'suspended' ? (
                <Button variant="primary" size="sm" loading={busy === 'resume'} onClick={() => void run('resume', () => api.resumeWorkspaceKey(workspace.id), 'Key resumed — boards open again')}>
                  Resume
                </Button>
              ) : null}
              {key.state === 'unavailable' ? (
                <Button size="sm" onClick={() => setConfirm('suspend')}>
                  Suspend
                </Button>
              ) : null}
              {owner ? (
                <Button variant="danger" size="sm" onClick={() => setConfirm('destroy')}>
                  Destroy key
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'destroy' ? 'Destroy the encryption key?' : 'Suspend the encryption key?'}
        width={460}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            {confirm === 'destroy' ? (
              <Button
                variant="danger"
                loading={busy === 'destroy'}
                disabled={typed !== workspace.name}
                onClick={() => void run('destroy', () => api.destroyWorkspaceKey(workspace.id, typed), 'Key destroyed')}
              >
                Destroy for good
              </Button>
            ) : (
              <Button variant="danger" loading={busy === 'suspend'} onClick={() => void run('suspend', () => api.suspendWorkspaceKey(workspace.id), 'Key suspended — boards are closed')}>
                Suspend
              </Button>
            )}
          </>
        }
      >
        {confirm === 'destroy' ? (
          <>
            <p className="fr-admin__modal-text">
              Every board of {workspace.name}, its history and drafts become unreadable forever — no one, including this server’s operators, can
              bring them back. Type the workspace’s name to confirm.
            </p>
            <Input label="Workspace name" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={workspace.name} />
          </>
        ) : (
          <p className="fr-admin__modal-text">Every board of {workspace.name} closes for everyone, right away, until an admin resumes the key here.</p>
        )}
      </Modal>
    </div>
  );
}

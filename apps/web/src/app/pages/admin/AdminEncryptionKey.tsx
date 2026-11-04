// The workspace's encryption key (#159; docs/design/compliance.md §3), for its security admins:
// turn a key on (the instance's, or the workspace's own key at AWS KMS, Google Cloud KMS, Azure Key
// Vault or Vault Transit — whichever this server is set up for), rotate it, suspend / resume
// it, and — owners only, typing the workspace's name — destroy it. Every action is checked again by
// the server; destroying is irreversible and says so.
import { useEffect, useState } from 'react';
import type { WorkspaceKeyProvider, WorkspaceKeyStatus, WorkspaceSummary } from '@freero/shared';
import { Button, Input, Modal, Spinner, useToast } from '@ui';
import { api, ApiError } from '../../api/client';

import { t } from './messages';
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);
const when = (ms: number) => new Date(ms).toLocaleString();

type External = Exclude<WorkspaceKeyProvider, 'instance'>;
/** Product names (not translated) and what each provider's key id looks like. */
const PROVIDER: Record<External, { name: string; example: string; format: string }> = {
  'aws-kms': { name: 'AWS KMS', example: 'arn:aws:kms:eu-west-1:111122223333:key/…', format: t('keyFormat.awsKms') },
  'gcp-kms': { name: 'Google Cloud KMS', example: 'projects/…/locations/…/keyRings/…/cryptoKeys/…', format: t('keyFormat.gcpKms') },
  'azure-key-vault': { name: 'Azure Key Vault', example: 'https://<vault>.vault.azure.net/keys/<name>', format: t('keyFormat.azureKeyVault') },
  'vault-transit': { name: 'HashiCorp Vault Transit', example: 'transit/keys/<name>', format: t('keyFormat.vaultTransit') },
};

const STATE: Record<NonNullable<WorkspaceKeyStatus['key']>['state'], { label: string; tone: 'ok' | 'warn' | 'off' }> = {
  active: { label: t('active'), tone: 'ok' },
  suspended: { label: t('suspended'), tone: 'off' },
  unavailable: { label: t('unavailable'), tone: 'warn' },
  destroyed: { label: t('destroyed'), tone: 'off' },
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
      notify(errorText(e, t('somethingWentWrongWithThe')), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (status === undefined) return <Spinner />;
  if (!status || (!status.key && !status.providers.length)) return null; // this server offers no workspace keys
  const key = status.key;
  const external = status.providers.filter((p): p is External => p !== 'instance');
  const kms = external.length > 0;
  const owner = workspace.role === 'owner';

  return (
    <div className="fr-admin-card">
      <h2 className="fr-admin-card__title">{t('encryptionKey')}</h2>
      <p className="fr-admin-row__hint">{t('boardContentOfThisWorkspace')}</p>
      {!key ? (
        <div className="fr-admin-key">
          {kms ? (
            <>
              <Input label={t('yourOwnKeyOptional')} value={arn} onChange={(e) => setArn(e.target.value)} placeholder={PROVIDER[external[0]].example} spellCheck={false} />
              <ul className="fr-admin-row__hint fr-admin-key__formats">
                {external.map((p) => (
                  <li key={p}>{PROVIDER[p].format}</li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="fr-admin-row__hint">
            {kms
              ? t('leaveItEmptyToUse')
              : t('theKeyIsManagedBy')}
          </p>
          <div className="fr-admin-networks__actions">
            <Button
              variant="primary"
              size="sm"
              loading={busy === 'create'}
              onClick={() => void run('create', () => api.createWorkspaceKey(workspace.id, arn.trim() ? { kmsKeyId: arn.trim() } : {}), t('encryptionKeyOnExistingBoards'))}
            >{t('turnOnEncryptionKey')}</Button>
          </div>
        </div>
      ) : (
        <div className="fr-admin-key">
          <div className="fr-admin-row">
            <div className="fr-admin-row__text">
              <span className="fr-admin-row__label">
                {key.provider === 'instance' ? t('managedByThisServer') : t('yourKeyAt', { provider: PROVIDER[key.provider].name })}{' '}
                <span className={`fr-admin-pill fr-admin-pill--${STATE[key.state].tone}`}>{STATE[key.state].label}</span>
              </span>
              <span className="fr-admin-row__hint">
                {key.kmsKeyId ? <code>{key.kmsKeyId}</code> : null}
                {key.kmsKeyId ? ' · ' : ''}{t('dataKeyVersionDatakeyversionOn', { dataKeyVersion: key.dataKeyVersion, when: when(key.createdAt) })}{key.kekRotatedAt ? t('rotatedWhen', { when: when(key.kekRotatedAt) }) : ''}
                {key.pendingBoards ? t('pendingboardsBoardsStillBeingEncrypted', { pendingBoards: key.pendingBoards }) : ''}
              </span>
              {key.state === 'unavailable' && key.reason ? <span className="fr-admin-row__hint">{t('theKeyServiceSaidReason', { reason: key.reason })}</span> : null}
              {key.state === 'destroyed' ? (
                <span className="fr-admin-row__hint">{t('theDataKeysWereDestroyed', { when: when(key.stateChangedAt) })}</span>
              ) : null}
            </div>
          </div>
          {key.state !== 'destroyed' ? (
            <div className="fr-admin-networks__actions">
              {key.state === 'active' ? (
                <>
                  <Button size="sm" loading={busy === 'rotate'} onClick={() => void run('rotate', () => api.rotateWorkspaceKey(workspace.id, {}), t('keyRotatedNewContentUses'))}>{t('rotateKey')}</Button>
                  <Button size="sm" onClick={() => setConfirm('suspend')}>{t('suspend')}</Button>
                </>
              ) : null}
              {key.state === 'suspended' ? (
                <Button variant="primary" size="sm" loading={busy === 'resume'} onClick={() => void run('resume', () => api.resumeWorkspaceKey(workspace.id), t('keyResumedBoardsOpenAgain'))}>{t('resume')}</Button>
              ) : null}
              {key.state === 'unavailable' ? (
                <Button size="sm" onClick={() => setConfirm('suspend')}>{t('suspend')}</Button>
              ) : null}
              {owner ? (
                <Button variant="danger" size="sm" onClick={() => setConfirm('destroy')}>{t('destroyKey')}</Button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === 'destroy' ? t('destroyTheEncryptionKey') : t('suspendTheEncryptionKey')}
        width={460}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>{t('cancel')}</Button>
            {confirm === 'destroy' ? (
              <Button
                variant="danger"
                loading={busy === 'destroy'}
                disabled={typed !== workspace.name}
                onClick={() => void run('destroy', () => api.destroyWorkspaceKey(workspace.id, typed), t('keyDestroyed'))}
              >{t('destroyForGood')}</Button>
            ) : (
              <Button variant="danger" loading={busy === 'suspend'} onClick={() => void run('suspend', () => api.suspendWorkspaceKey(workspace.id), t('keySuspendedBoardsAreClosed'))}>{t('suspend')}</Button>
            )}
          </>
        }
      >
        {confirm === 'destroy' ? (
          <>
            <p className="fr-admin__modal-text">{t('everyBoardOfNameIts', { name: workspace.name })}</p>
            <Input label={t('workspaceName')} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={workspace.name} />
          </>
        ) : (
          <p className="fr-admin__modal-text">{t('everyBoardOfNameCloses', { name: workspace.name })}</p>
        )}
      </Modal>
    </div>
  );
}

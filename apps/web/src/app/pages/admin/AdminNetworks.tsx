// The workspace's IP allowlist (#156), for its security admins: the networks its boards open from,
// one range per line. Saving a list that leaves out the address you use now asks first — you would
// lose the boards from here, never the console. For an organisation it applies to every workspace.
import { useEffect, useState } from 'react';
import { IP_ALLOWLIST_EXCLUDES_YOU, type WorkspaceSummary } from '@freero/shared';
import { Button, Modal, Spinner, useToast } from '@ui';
import { api, ApiError } from '../../api/client';

import { t } from './messages';
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);
const toLines = (list: string[]) => list.join('\n');
const fromLines = (text: string) =>
  text
    .split(/[\n,]+/)
    .map((l) => l.trim())
    .filter(Boolean);

export function AdminNetworks({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const org = workspace.kind === 'organisation';
  const [saved, setSaved] = useState<string[] | null>(null);
  const [text, setText] = useState('');
  const [yourIp, setYourIp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    api.workspaceSettings(workspace.id).then(
      (r) => {
        setSaved(r.settings.ipAllowlist ?? []);
        setText(toLines(r.settings.ipAllowlist ?? []));
        setYourIp(r.yourIp ?? null);
      },
      () => setSaved([]),
    );
  }, [workspace.id]);

  const save = async (confirmExcludesMe = false) => {
    setBusy(true);
    try {
      const { settings } = await api.updateWorkspaceSettings(workspace.id, { ipAllowlist: fromLines(text), ...(confirmExcludesMe ? { confirmExcludesMe: true } : {}) });
      setSaved(settings.ipAllowlist);
      setText(toLines(settings.ipAllowlist));
      setConfirm(null);
      notify(settings.ipAllowlist.length ? t('savedBoardsOpenOnlyFrom') : t('savedBoardsOpenFromAnywhere'), 'success');
    } catch (e) {
      if (e instanceof ApiError && e.code === IP_ALLOWLIST_EXCLUDES_YOU) setConfirm(e.message);
      else notify(errorText(e, t('couldNotSaveTheNetworks')), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!saved) return <Spinner />;
  const dirty = toLines(fromLines(text)) !== toLines(saved);
  return (
    <div className="fr-admin-card">
      <h2 className="fr-admin-card__title">{t('allowedNetworks')}</h2>
      <p className="fr-admin-row__hint">
        {org ? t('everyWorkspaceInNameOpens', { name: workspace.name }) : t('itsBoardsOnTheWeb')}{t('oneIpv4OrIpv6Range')}{yourIp ? t('youAreOnYourip', { yourIp }) : ''}
      </p>
      <textarea
        className="fr-admin-networks"
        aria-label={t('allowedNetworksOneRangePer')}
        rows={Math.min(8, Math.max(3, fromLines(text).length + 1))}
        value={text}
        placeholder={t('n2030113024')}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="fr-admin-networks__actions">
        <Button variant="primary" size="sm" loading={busy && !confirm} disabled={!dirty} onClick={() => void save()}>{t('saveNetworks')}</Button>
      </div>
      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={t('leaveOutYourOwnNetwork')}
        width={440}
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>{t('cancel')}</Button>
            <Button variant="danger" loading={busy} onClick={() => void save(true)}>{t('saveAnyway')}</Button>
          </>
        }
      >
        <p className="fr-admin__modal-text">{t('confirmYouCanAlwaysCome', { confirm })}</p>
      </Modal>
    </div>
  );
}

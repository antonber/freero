// The sensitive-data scan (#158; docs/design/compliance.md §2), in the Classification tab: turn it
// on, choose what it looks for and what a finding does (tell admins, suggest a label, require one),
// and the boards where it found something — where and what kind, never the text that matched. The
// server scans and enforces; content admins only.
import { useCallback, useEffect, useState } from 'react';
import { SquareArrowOutUpRight } from 'lucide-react';
import { SENSITIVE_DATA_KINDS, type BoardLabel, type SensitiveDataAction, type SensitiveDataKind, type SensitiveDataSettingsInput, type SensitiveDataStatus, type WorkspaceSummary } from '@freero/shared';
import { formatDate, Select, Spinner, Toggle, useToast } from '@ui';
import { api, ApiError } from '../../api/client';

import { t } from './messages';
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);

export const KIND_TEXT: Record<SensitiveDataKind, string> = {
  payment_card: t('sensitive.kind.paymentCard'),
  iban: t('sensitive.kind.iban'),
  national_id: t('sensitive.kind.nationalId'),
  secret: t('sensitive.kind.secret'),
  email: t('sensitive.kind.email'),
  phone: t('sensitive.kind.phone'),
};

export function AdminSensitiveData({ workspace, labels }: { workspace: WorkspaceSummary; labels: BoardLabel[] }) {
  const notify = useToast();
  const [status, setStatus] = useState<SensitiveDataStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.sensitiveData(workspace.id).then(setStatus, (e) => notify(errorText(e, t('sensitive.couldNotLoad')), 'error'));
  }, [workspace.id, notify]);
  useEffect(load, [load]);

  const save = async (patch: SensitiveDataSettingsInput) => {
    setBusy(true);
    try {
      setStatus(await api.setSensitiveData(workspace.id, patch));
    } catch (e) {
      notify(errorText(e, t('couldNotChangeIt')), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <Spinner />;
  const s = status.settings;
  const kinds = new Set(s.kinds);
  const toggleKind = (k: SensitiveDataKind, on: boolean) => void save({ kinds: SENSITIVE_DATA_KINDS.filter((x) => (x === k ? on : kinds.has(x))) });
  const setAction = (action: SensitiveDataAction) => {
    // Suggesting or requiring needs a label: the first one, until they pick another.
    const labelId = s.labelId ?? (action !== 'notify' ? (labels[0]?.id ?? null) : null);
    if (action !== 'notify' && !labelId) return notify(t('sensitive.createALabelFirst'), 'error');
    void save({ action, labelId });
  };
  return (
    <div className="fr-admin-card fr-admin-sensitive">
      <h2 className="fr-admin-card__title">{t('sensitive.title')}</h2>
      <p className="fr-admin-row__hint">{t('sensitive.intro')}</p>
      <Toggle size="sm" label={t('sensitive.scanBoards')} checked={s.enabled} disabled={busy} onChange={(on) => void save({ enabled: on })} />
      {s.enabled ? (
        <>
          <fieldset className="fr-admin-sensitive__kinds">
            <legend className="fr-admin-row__label">{t('sensitive.lookFor')}</legend>
            {SENSITIVE_DATA_KINDS.map((k) => (
              <Toggle key={k} size="sm" label={KIND_TEXT[k]} checked={kinds.has(k)} disabled={busy || (kinds.has(k) && kinds.size === 1)} onChange={(on) => toggleKind(k, on)} />
            ))}
          </fieldset>
          <div className="fr-admin-labels__policy">
            <label className="fr-admin-labels__choice">
              <span>{t('sensitive.whenFound')}</span>
              <Select
                size="sm"
                aria-label={t('sensitive.whenFound')}
                value={s.action}
                disabled={busy}
                onChange={(v) => setAction(v as SensitiveDataAction)}
                options={[
                  { value: 'notify', label: t('sensitive.action.notify') },
                  { value: 'suggest', label: t('sensitive.action.suggest') },
                  { value: 'require', label: t('sensitive.action.require') },
                ]}
              />
            </label>
            {s.action !== 'notify' ? (
              <label className="fr-admin-labels__choice">
                <span>{t('label')}</span>
                <Select
                  size="sm"
                  aria-label={t('label')}
                  value={s.labelId ?? ''}
                  disabled={busy}
                  onChange={(v) => void save({ labelId: v || null })}
                  options={labels.map((l) => ({ value: l.id, label: l.name }))}
                />
              </label>
            ) : null}
          </div>
          <p className="fr-admin-card__note">{s.action === 'require' ? t('sensitive.requireNote') : s.action === 'suggest' ? t('sensitive.suggestNote') : t('sensitive.notifyNote')}</p>
          <h3 className="fr-admin-row__label">{t('sensitive.findings')}</h3>
          {status.findings.length ? (
            <div className="fr-admin-table-wrap">
              <table className="fr-admin-table">
                <thead>
                  <tr>
                    <th scope="col">{t('sensitive.board')}</th>
                    <th scope="col">{t('sensitive.what')}</th>
                    <th scope="col">{t('sensitive.where')}</th>
                    <th scope="col">{t('sensitive.found')}</th>
                  </tr>
                </thead>
                <tbody>
                  {status.findings.map((f) => (
                    <tr key={`${f.boardId}:${f.elementId ?? f.where}:${f.kind}`}>
                      <td>
                        <a className="fr-admin-sensitive__board" href={`/board/${encodeURIComponent(f.boardId)}${f.elementId ? `?item=${encodeURIComponent(f.elementId)}` : ''}`}>
                          {f.boardTitle || t('sensitive.untitled')}
                          <SquareArrowOutUpRight size={12} aria-hidden />
                        </a>
                      </td>
                      <td>{t('sensitive.kindCount', { kind: KIND_TEXT[f.kind], count: f.count })}</td>
                      <td className="fr-admin__muted">{f.where === 'comment' ? t('sensitive.inAComment') : f.where === 'board' ? t('sensitive.inTheTitle') : t('sensitive.onAnItem')}</td>
                      <td className="fr-admin__muted">{formatDate(f.foundAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="fr-admin__muted">{t('sensitive.nothingFound')}</p>
          )}
        </>
      ) : null}
    </div>
  );
}

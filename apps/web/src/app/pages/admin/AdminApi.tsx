// API & apps (KAI-104, KAI-170): a team's switch for API access to its boards, and every API token
// and app that has reached them, with a per-workspace block. The server enforces both on every call.
import { useEffect, useState } from 'react';
import { Ban, CircleCheck } from 'lucide-react';
import type { WorkspaceApiInfo, WorkspaceSummary } from '@freero/shared';
import { Button, Spinner, Toggle, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { relativeTime } from '../../lib/time';

import { t } from './messages';
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);

export function AdminApi({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [info, setInfo] = useState<WorkspaceApiInfo | null>(null);
  useEffect(() => {
    api.workspaceApi(workspace.id).then(setInfo, (e) => notify(errorText(e, t('couldNotLoadApiAccess')), 'error'));
  }, [workspace.id, notify]);

  const toggle = async (enabled: boolean) => {
    try {
      setInfo(await api.setWorkspaceApi(workspace.id, enabled));
      notify(enabled ? t('tokensAndAppsCanUse') : t('apiAccessIsOffTokens'), 'success');
    } catch (e) {
      notify(errorText(e, t('couldNotChangeApiAccess')), 'error');
    }
  };
  const block = async (id: string, blocked: boolean, label: string) => {
    try {
      setInfo(await api.setWorkspaceCredentialBlocked(workspace.id, id, blocked));
      notify(blocked ? t('blockedLabelInName', { label, name: workspace.name }) : t('unblockedLabel', { label }), 'success');
    } catch (e) {
      notify(errorText(e, t('couldNotChangeTheBlock')), 'error');
    }
  };

  const exempt = async (id: string, on: boolean, label: string) => {
    try {
      setInfo(await api.setWorkspaceCredentialIpExempt(workspace.id, id, on));
      notify(on ? t('labelMayReachNameFrom', { label, name: workspace.name }) : t('labelFollowsTheAllowedNetworks', { label }), 'success');
    } catch (e) {
      notify(errorText(e, t('couldNotChangeIt')), 'error');
    }
  };

  if (!info) return <Spinner />;
  return (
    <section aria-labelledby="admin-api-title">
      <h1 id="admin-api-title" className="fr-admin__title">{t('apiApps')}</h1>
      <p className="fr-admin__intro">{t('peopleCanConnectScriptsIntegrations')}</p>
      <div className="fr-admin-card">
        <div className="fr-admin-row">
          <div className="fr-admin-row__text">
            <span className="fr-admin-row__label">{t('allowApiAccessToThis')}</span>
            <span className="fr-admin-row__hint">{t('offEveryTokenAndApp')}</span>
          </div>
          <div className="fr-admin-row__control">
            <Toggle aria-label={t('allowApiAccessToThis')} checked={info.enabled} onChange={(on) => void toggle(on)} />
          </div>
        </div>
      </div>

      <h2 className="fr-admin__subtitle">{t('tokensAndAppsUsedHere')}</h2>
      {info.credentials.length === 0 ? (
        <p className="fr-admin__muted">{t('noTokenOrAppHas')}</p>
      ) : (
        <div className="fr-admin-table-wrap">
          <table className="fr-admin-table">
            <thead>
              <tr>
                <th>{t('tokenOrApp')}</th>
                <th>{t('person')}</th>
                <th>{t('permissions')}</th>
                <th>{t('lastUsed')}</th>
                <th>
                  <span className="fr-admin__sr">{t('actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {info.credentials.map((c) => (
                <tr key={c.id} className={c.blocked ? 'fr-admin-table__row--off' : undefined} data-testid="api-credential-row">
                  <td>
                    <div className="fr-admin-person__name">
                      {c.label}
                      {c.blocked ? <span className="fr-admin-pill fr-admin-pill--off">{t('blocked')}</span> : null}
                    </div>
                    <div className="fr-admin__muted">{c.kind === 'oauth' ? t('authorisedApp') : t('personalApiToken')}</div>
                  </td>
                  <td>
                    <div className="fr-admin-person__name">{c.user?.name ?? t('deletedUser')}</div>
                    <div className="fr-admin__muted">{c.user?.email}</div>
                  </td>
                  <td className="fr-admin__muted">{c.scopes.join(', ')}</td>
                  <td className="fr-admin__muted fr-admin__nowrap">{relativeTime(c.lastUsedAt)}</td>
                  <td className="fr-admin-table__actions">
                    {c.ipExempt !== undefined ? (
                      <label className="fr-admin-scopes__item" title={t('exemptFromTheWorkspaceS')}>
                        <input type="checkbox" checked={c.ipExempt} onChange={() => void exempt(c.id, !c.ipExempt, c.label)} />{t('anyNetwork')}</label>
                    ) : null}
                    {c.blocked ? (
                      <Button size="sm" icon={CircleCheck} onClick={() => void block(c.id, false, c.label)}>{t('unblock')}</Button>
                    ) : (
                      <Button size="sm" variant="ghost" icon={Ban} onClick={() => void block(c.id, true, c.label)}>{t('blockHere')}</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="fr-admin__muted">A block applies to this workspace only; the person can still use the token or app elsewhere. Revoking it is up to them.</p>
    </section>
  );
}

// API & apps (KAI-104, KAI-170): a team's switch for API access to its boards, and every API token
// and app that has reached them, with a per-workspace block. The server enforces both on every call.
import { useEffect, useState } from 'react';
import { Ban, CircleCheck } from 'lucide-react';
import type { WorkspaceApiInfo, WorkspaceSummary } from '@freero/shared';
import { Button, Spinner, Toggle, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { relativeTime } from '../../lib/time';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);

export function AdminApi({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [info, setInfo] = useState<WorkspaceApiInfo | null>(null);
  useEffect(() => {
    api.workspaceApi(workspace.id).then(setInfo, (e) => notify(errorText(e, 'Could not load API access'), 'error'));
  }, [workspace.id, notify]);

  const toggle = async (enabled: boolean) => {
    try {
      setInfo(await api.setWorkspaceApi(workspace.id, enabled));
      notify(enabled ? 'Tokens and apps can use this workspace’s boards again' : 'API access is off: tokens and apps are refused from their next call', 'success');
    } catch (e) {
      notify(errorText(e, 'Could not change API access'), 'error');
    }
  };
  const block = async (id: string, blocked: boolean, label: string) => {
    try {
      setInfo(await api.setWorkspaceCredentialBlocked(workspace.id, id, blocked));
      notify(blocked ? `Blocked “${label}” in ${workspace.name}` : `Unblocked “${label}”`, 'success');
    } catch (e) {
      notify(errorText(e, 'Could not change the block'), 'error');
    }
  };

  if (!info) return <Spinner />;
  return (
    <section aria-labelledby="admin-api-title">
      <h1 id="admin-api-title" className="fr-admin__title">
        API &amp; apps
      </h1>
      <p className="fr-admin__intro">
        People can connect scripts, integrations and AI assistants to Freero with API tokens or by authorising an app. They only ever act
        with that person’s access, and every call is in the audit log.
      </p>
      <div className="fr-admin-card">
        <div className="fr-admin-row">
          <div className="fr-admin-row__text">
            <span className="fr-admin-row__label">Allow API access to this workspace’s boards</span>
            <span className="fr-admin-row__hint">
              Off: every token and app is refused on this workspace’s boards from its next call — people keep using Freero in the browser.
              Reading boards through the API also follows your downloads policy.
            </span>
          </div>
          <div className="fr-admin-row__control">
            <Toggle aria-label="Allow API access to this workspace’s boards" checked={info.enabled} onChange={(on) => void toggle(on)} />
          </div>
        </div>
      </div>

      <h2 className="fr-admin__subtitle">Tokens and apps used here</h2>
      {info.credentials.length === 0 ? (
        <p className="fr-admin__muted">No token or app has used this workspace’s boards yet.</p>
      ) : (
        <div className="fr-admin-table-wrap">
          <table className="fr-admin-table">
            <thead>
              <tr>
                <th>Token or app</th>
                <th>Person</th>
                <th>Permissions</th>
                <th>Last used</th>
                <th>
                  <span className="fr-admin__sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {info.credentials.map((c) => (
                <tr key={c.id} className={c.blocked ? 'fr-admin-table__row--off' : undefined} data-testid="api-credential-row">
                  <td>
                    <div className="fr-admin-person__name">
                      {c.label}
                      {c.blocked ? <span className="fr-admin-pill fr-admin-pill--off">Blocked</span> : null}
                    </div>
                    <div className="fr-admin__muted">{c.kind === 'oauth' ? 'Authorised app' : 'Personal API token'}</div>
                  </td>
                  <td>
                    <div className="fr-admin-person__name">{c.user?.name ?? 'Deleted user'}</div>
                    <div className="fr-admin__muted">{c.user?.email}</div>
                  </td>
                  <td className="fr-admin__muted">{c.scopes.join(', ')}</td>
                  <td className="fr-admin__muted fr-admin__nowrap">{relativeTime(c.lastUsedAt)}</td>
                  <td className="fr-admin-table__actions">
                    {c.blocked ? (
                      <Button size="sm" icon={CircleCheck} onClick={() => void block(c.id, false, c.label)}>
                        Unblock
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" icon={Ban} onClick={() => void block(c.id, true, c.label)}>
                        Block here
                      </Button>
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

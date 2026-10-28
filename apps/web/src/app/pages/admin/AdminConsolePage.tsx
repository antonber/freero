// /admin/:workspaceId — the admin console of a team workspace (owners and admins): overview and
// usage, members, security, single sign-on, provisioning, data (retention and export) and the
// audit log. Every action is checked again by the server; this page only hides what the caller's
// role can't do.
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChartColumn, Hourglass, KeyRound, Lock, Plug, ScrollText, UserCog, Users } from 'lucide-react';
import type { WorkspaceSummary } from '@freero/shared';
import { Logo, Spinner } from '@ui';
import { api } from '../../api/client';
import { AdminApi } from './AdminApi';
import { AdminAudit } from './AdminAudit';
import { AdminDataExport, AdminProvisioning, AdminSso } from './AdminIdentity';
import { AdminMembers } from './AdminMembers';
import { AdminOverview } from './AdminOverview';
import { AdminRetention, AdminSecurity } from './AdminSettings';
import './admin.css';

const TABS = [
  { id: 'overview', label: 'Overview', icon: ChartColumn },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'security', label: 'Security', icon: Lock },
  { id: 'sso', label: 'Single sign-on', icon: KeyRound },
  { id: 'provisioning', label: 'Provisioning', icon: UserCog },
  { id: 'retention', label: 'Data', icon: Hourglass },
  { id: 'api', label: 'API & apps', icon: Plug },
  { id: 'audit', label: 'Audit log', icon: ScrollText },
] as const;
type Tab = (typeof TABS)[number]['id'];

export function AdminConsolePage() {
  const { workspaceId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as Tab) : 'overview';
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    api
      .listWorkspaces()
      .then(({ workspaces }) => live && setWorkspace(workspaces.find((w) => w.id === workspaceId) ?? null))
      .catch(() => live && setWorkspace(null));
    return () => {
      live = false;
    };
  }, [workspaceId]);

  useEffect(() => {
    document.title = workspace ? `Admin console · ${workspace.name} · Freero` : 'Admin console · Freero';
  }, [workspace]);

  const manager = (workspace?.role === 'owner' || workspace?.role === 'admin') && workspace.blocked !== 'deactivated';
  const back = `/app?ws=${encodeURIComponent(workspaceId)}`;

  return (
    <div className="fr-admin">
      <header className="fr-admin__top">
        <Link to={back} className="fr-admin__back">
          <ArrowLeft size={16} aria-hidden /> Back to boards
        </Link>
        <Logo size={26} withWordmark />
      </header>
      {workspace === undefined ? (
        <div className="fr-admin__center">
          <Spinner />
        </div>
      ) : !workspace || workspace.kind !== 'team' || !manager ? (
        <div className="fr-admin__center">
          <h1 className="fr-admin__title">Admin console</h1>
          <p className="fr-admin__muted">Only owners and admins of a team workspace can open its admin console.</p>
        </div>
      ) : (
        <div className="fr-admin__body">
          <nav className="fr-admin__tabs" aria-label="Admin console">
            <div className="fr-admin__ws">
              <span className="fr-admin__ws-name">{workspace.name}</span>
              <span className="fr-admin__muted">Admin console · you’re {workspace.role === 'owner' ? 'an owner' : 'an admin'}</span>
            </div>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`fr-admin__tab${tab === t.id ? ' fr-admin__tab--active' : ''}`}
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => setParams(t.id === 'overview' ? {} : { tab: t.id }, { replace: true })}
              >
                <t.icon size={17} aria-hidden />
                {t.label}
              </button>
            ))}
          </nav>
          <main className="fr-admin__main">
            {tab === 'overview' ? <AdminOverview workspace={workspace} onOpen={(t) => setParams({ tab: t })} /> : null}
            {tab === 'members' ? <AdminMembers workspace={workspace} /> : null}
            {tab === 'security' ? <AdminSecurity workspace={workspace} onChanged={setWorkspace} /> : null}
            {tab === 'sso' ? <AdminSso workspace={workspace} /> : null}
            {tab === 'provisioning' ? <AdminProvisioning workspace={workspace} /> : null}
            {tab === 'retention' ? (
              <>
                <AdminRetention workspace={workspace} />
                <AdminDataExport workspace={workspace} />
              </>
            ) : null}
            {tab === 'api' ? <AdminApi workspace={workspace} /> : null}
            {tab === 'audit' ? <AdminAudit workspace={workspace} /> : null}
          </main>
        </div>
      )}
    </div>
  );
}

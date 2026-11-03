// /admin/:workspaceId — the admin console of a team workspace (owners and admins): overview and
// usage, members, security, single sign-on, provisioning, AI (when the server offers it), data
// (retention and export), API & apps, webhooks (when the server offers them), issue trackers and the
// audit log. Every action is checked again by the server; this page only hides what the caller's role
// can't do.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChartColumn, Hourglass, LayoutGrid, LayoutTemplate, UsersRound, KeyRound, Lock, Plug, ScrollText, Sparkles, Ticket, Trash2, UserCog, Users, Webhook } from 'lucide-react';
import { ADMIN_SCOPES, type AdminScope, type WorkspaceSummary } from '@freero/shared';
import { Logo, Spinner } from '@ui';
import { api } from '../../api/client';
import { AdminAi, aiOffered } from './AdminAi';
import { AdminApi } from './AdminApi';
import { AdminAudit } from './AdminAudit';
import { AdminDataExport, AdminProvisioning, AdminSso } from './AdminIdentity';
import { AdminMembers } from './AdminMembers';
import { WorkspaceOrganisation } from './AdminOrganisation';
import { AdminOverview } from './AdminOverview';
import { AdminRetention, AdminSecurity } from './AdminSettings';
import { AdminSiem, siemOffered } from './AdminSiem';
import { AdminWebhooks, webhooksOffered } from './AdminWebhooks';
import { AdminTrackers } from './AdminTrackers';
import { AdminTrash } from './AdminTrash';
import { AdminBoards } from './AdminBoards';
import { AdminGroups } from './AdminGroups';
import { AdminTemplates } from './AdminTemplates';
import './admin.css';

// `scopes` (#151): the admin scopes that use the tab (any of them); none: every admin.
const TABS = [
  { id: 'overview', label: 'Overview', icon: ChartColumn, scopes: [] },
  { id: 'members', label: 'Members', icon: Users, scopes: ['members'] },
  { id: 'groups', label: 'Groups', icon: UsersRound, scopes: ['members'] },
  { id: 'security', label: 'Security', icon: Lock, scopes: ['security', 'content'] },
  { id: 'boards', label: 'Boards', icon: LayoutGrid, scopes: ['content'] },
  { id: 'trash', label: 'Trash', icon: Trash2, scopes: ['content'] },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate, scopes: ['content'] },
  { id: 'sso', label: 'Single sign-on', icon: KeyRound, scopes: ['security'] },
  { id: 'provisioning', label: 'Provisioning', icon: UserCog, scopes: ['security'] },
  { id: 'ai', label: 'AI', icon: Sparkles, scopes: ['security'] },
  { id: 'retention', label: 'Data', icon: Hourglass, scopes: ['content', 'security'] },
  { id: 'api', label: 'API & apps', icon: Plug, scopes: ['security'] },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook, scopes: ['security'] },
  { id: 'trackers', label: 'Issue trackers', icon: Ticket, scopes: ['security'] },
  { id: 'audit', label: 'Audit log', icon: ScrollText, scopes: ['security'] },
] as const;

/** What the caller administers (a server from before #151 sends nothing: everything). */
export const scopesOf = (w: Pick<WorkspaceSummary, 'adminScopes'>): readonly AdminScope[] => w.adminScopes ?? ADMIN_SCOPES;
const usable = (t: { scopes: readonly AdminScope[] }, mine: readonly AdminScope[]) => t.scopes.length === 0 || t.scopes.some((s) => mine.includes(s));
type Tab = (typeof TABS)[number]['id'];

export function AdminConsolePage() {
  const { workspaceId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const requested: Tab = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as Tab) : 'overview';
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null | undefined>(undefined);
  // The AI tab exists only when this server offers AI at all.
  const [ai, setAi] = useState(false);
  // And the Webhooks tab only when it offers webhooks.
  const [hooks, setHooks] = useState(false);
  // And audit streaming only when it offers that.
  const [siem, setSiem] = useState(false);

  // Reloaded after it joins an organisation: its policies and settings may have tightened.
  const reload = useCallback(() => {
    api
      .listWorkspaces()
      .then(({ workspaces }) => setWorkspace(workspaces.find((w) => w.id === workspaceId) ?? null))
      .catch(() => setWorkspace(null));
  }, [workspaceId]);
  useEffect(reload, [reload]);

  const manages = workspace?.kind === 'team' && (workspace.role === 'owner' || workspace.role === 'admin');
  useEffect(() => {
    let live = true;
    if (manages) void aiOffered(workspaceId).then((on) => live && setAi(on));
    if (manages) void webhooksOffered(workspaceId).then((on) => live && setHooks(on));
    if (manages) void siemOffered(workspaceId).then((on) => live && setSiem(on));
    return () => {
      live = false;
    };
  }, [workspaceId, manages]);

  useEffect(() => {
    document.title = workspace ? `Admin console · ${workspace.name} · Freero` : 'Admin console · Freero';
  }, [workspace]);

  const mine = workspace ? scopesOf(workspace) : ADMIN_SCOPES;
  const tab: Tab =
    (requested === 'ai' && !ai) || (requested === 'webhooks' && !hooks) || !usable(TABS.find((t) => t.id === requested)!, mine) ? 'overview' : requested;
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
              <span className="fr-admin__muted">
                Admin console · you’re {workspace.role === 'owner' ? 'an owner' : mine.length === ADMIN_SCOPES.length ? 'an admin' : `a ${mine.join(' and ')} admin`}
              </span>
            </div>
            {TABS.filter((t) => (t.id !== 'ai' || ai) && (t.id !== 'webhooks' || hooks) && usable(t, mine)).map((t) => (
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
            {tab === 'overview' ? (
              <>
                <AdminOverview workspace={workspace} onOpen={(t) => setParams({ tab: t })} />
                <WorkspaceOrganisation key={workspace.organisation?.id ?? 'none'} workspace={workspace} onChanged={reload} />
              </>
            ) : null}
            {tab === 'security' ? <AdminSecurity key={workspace.organisation?.id ?? 'none'} workspace={workspace} onChanged={setWorkspace} /> : null}
            {tab === 'members' ? <AdminMembers workspace={workspace} /> : null}
            {tab === 'groups' ? <AdminGroups workspace={workspace} /> : null}
            {tab === 'boards' ? <AdminBoards workspace={workspace} /> : null}
            {tab === 'trash' ? <AdminTrash workspace={workspace} /> : null}
            {tab === 'templates' ? <AdminTemplates workspace={workspace} /> : null}
            {tab === 'sso' ? <AdminSso workspace={workspace} /> : null}
            {tab === 'provisioning' ? <AdminProvisioning workspace={workspace} /> : null}
            {tab === 'ai' ? <AdminAi workspace={workspace} /> : null}
            {tab === 'retention' ? (
              <>
                <AdminRetention workspace={workspace} />
                {mine.includes('security') ? <AdminDataExport workspace={workspace} /> : null}
              </>
            ) : null}
            {tab === 'api' ? <AdminApi workspace={workspace} /> : null}
            {tab === 'webhooks' ? <AdminWebhooks workspace={workspace} /> : null}
            {tab === 'trackers' ? <AdminTrackers workspace={workspace} /> : null}
            {tab === 'audit' ? (
              <>
                <AdminAudit workspace={workspace} />
                {siem ? <AdminSiem workspace={workspace} /> : null}
              </>
            ) : null}
          </main>
        </div>
      )}
    </div>
  );
}

// /org/:organisationId — the console of an organisation above team workspaces (#108; owners and
// admins of the organisation): its workspaces, its people, the policies every workspace gets at
// least, single sign-on, provisioning, and the merged audit log with its streams. The tabs are the
// workspace admin console's, pointed at the organisation's id; the server checks every action.
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Building2, KeyRound, LayoutTemplate, Lock, ScrollText, UserCog, Users } from 'lucide-react';
import type { AdminScope, OrganisationSummary, WorkspaceSummary } from '@freero/shared';
import { Logo, Spinner } from '@ui';
import { api } from '../../api/client';
import { AdminAudit } from './AdminAudit';
import { AdminProvisioning, AdminSso } from './AdminIdentity';
import { AdminMembers } from './AdminMembers';
import { OrgWorkspaces } from './AdminOrganisation';
import { AdminRetention, AdminSecurity } from './AdminSettings';
import { AdminSiem, siemOffered } from './AdminSiem';
import { AdminTemplates } from './AdminTemplates';
import { scopesOf } from './AdminConsolePage';
import './admin.css';

// `scopes` (#151): the admin scopes that use the tab; none: every admin.
const TABS = [
  { id: 'workspaces', label: 'Workspaces', icon: Building2, scopes: [] },
  { id: 'people', label: 'People', icon: Users, scopes: ['members'] },
  { id: 'policies', label: 'Policies', icon: Lock, scopes: ['security', 'content'] },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate, scopes: ['content'] },
  { id: 'sso', label: 'Single sign-on', icon: KeyRound, scopes: ['security'] },
  { id: 'provisioning', label: 'Provisioning', icon: UserCog, scopes: ['security'] },
  { id: 'audit', label: 'Audit log', icon: ScrollText, scopes: ['security'] },
] as const;
type Tab = (typeof TABS)[number]['id'];

export function OrgConsolePage() {
  const { organisationId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  // The identity tabs link to `?tab=security` (their session policy): the Policies tab here.
  const asked = params.get('tab') === 'security' ? 'policies' : params.get('tab');
  const [org, setOrg] = useState<OrganisationSummary | null | undefined>(undefined);
  const mine = org ? scopesOf(org) : [];
  const shown = TABS.filter((t) => t.scopes.length === 0 || t.scopes.some((s) => (mine as readonly AdminScope[]).includes(s)));
  const tab: Tab = shown.some((t) => t.id === asked) ? (asked as Tab) : 'workspaces';
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [siem, setSiem] = useState(false);

  const reload = useCallback(() => {
    api
      .listOrganisations()
      .then(({ organisations }) => setOrg(organisations.find((o) => o.id === organisationId) ?? null))
      .catch(() => setOrg(null));
  }, [organisationId]);
  useEffect(reload, [reload]);

  const manager = org?.role === 'owner' || org?.role === 'admin';
  useEffect(() => {
    let live = true;
    if (!manager) return;
    void siemOffered(organisationId).then((on) => live && setSiem(on));
    api.organisationWorkspaces(organisationId).then(
      ({ workspaces }) => live && setNames(new Map(workspaces.map((w) => [w.id, w.name]))),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [organisationId, manager, org?.workspaceCount]);

  useEffect(() => {
    document.title = org ? `Organisation · ${org.name} · Freero` : 'Organisation · Freero';
  }, [org]);

  // The shared tabs take a workspace summary; an organisation is shaped like one.
  const asWorkspace = org as WorkspaceSummary | null | undefined;

  return (
    <div className="fr-admin">
      <header className="fr-admin__top">
        <Link to="/app" className="fr-admin__back">
          <ArrowLeft size={16} aria-hidden /> Back to boards
        </Link>
        <Logo size={26} withWordmark />
      </header>
      {org === undefined ? (
        <div className="fr-admin__center">
          <Spinner />
        </div>
      ) : !org || !manager || !asWorkspace ? (
        <div className="fr-admin__center">
          <h1 className="fr-admin__title">Organisation</h1>
          <p className="fr-admin__muted">Only owners and admins of an organisation can open its console.</p>
        </div>
      ) : (
        <div className="fr-admin__body">
          <nav className="fr-admin__tabs" aria-label="Organisation console">
            <div className="fr-admin__ws">
              <span className="fr-admin__ws-name">{org.name}</span>
              <span className="fr-admin__muted">Organisation · you’re {org.role === 'owner' ? 'an owner' : 'an admin'}</span>
            </div>
            {shown.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`fr-admin__tab${tab === t.id ? ' fr-admin__tab--active' : ''}`}
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => setParams(t.id === 'workspaces' ? {} : { tab: t.id }, { replace: true })}
              >
                <t.icon size={17} aria-hidden />
                {t.label}
              </button>
            ))}
          </nav>
          <main className="fr-admin__main">
            {tab === 'workspaces' ? <OrgWorkspaces organisation={org} onChanged={reload} /> : null}
            {tab === 'people' ? <AdminMembers workspace={asWorkspace} /> : null}
            {tab === 'policies' ? <AdminSecurity workspace={asWorkspace} onChanged={reload} /> : null}
            {tab === 'templates' ? <AdminTemplates workspace={asWorkspace} /> : null}
            {tab === 'sso' ? <AdminSso workspace={asWorkspace} /> : null}
            {tab === 'provisioning' ? <AdminProvisioning workspace={asWorkspace} /> : null}
            {tab === 'audit' ? (
              <>
                <AdminAudit workspace={asWorkspace} workspaceNames={names} />
                {siem ? <AdminSiem workspace={asWorkspace} /> : null}
                <AdminRetention workspace={asWorkspace} />
              </>
            ) : null}
          </main>
        </div>
      )}
    </div>
  );
}

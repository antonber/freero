// A team workspace's enterprise settings (owners/admins): single sign-on (verified domains, the
// identity provider, "Enforce SSO"), provisioning (SCIM tokens and what directory groups grant),
// and data exports. The server enforces every rule; this page only edits and explains.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Copy, Download, KeyRound, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import type {
  DataExportInfo,
  ProjectSummary,
  ScimGroupMapping,
  ScimSettings,
  SsoProtocol,
  SsoSettings,
  WorkspaceMember,
  WorkspaceSummary,
} from '@freero/shared';
import { Button, Input, Modal, SegmentedControl, Select, TextArea, Toggle, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../../api/client';
import './enterprise.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : 'never');
const size = (b: number | null) => (b === null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

function CopyField({ label, value }: { label: string; value: string }) {
  const notify = useToast();
  return (
    <div className="fr-dash-sso__copy">
      <span className="fr-dash-settings__label">{label}</span>
      <code>{value}</code>
      <Button
        size="sm"
        variant="ghost"
        icon={Copy}
        onClick={() => void navigator.clipboard?.writeText(value).then(() => notify('Copied', 'success'), () => notify('Could not copy', 'error'))}
      >
        Copy
      </Button>
    </div>
  );
}

const ROLE_OPTIONS: SelectOption<'member' | 'guest' | 'admin'>[] = [
  { value: 'member', label: 'Member' },
  { value: 'guest', label: 'Guest' },
  { value: 'admin', label: 'Admin' },
];

// ---- Single sign-on ----

export function SsoBlock({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [s, setS] = useState<SsoSettings | null>(null);
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [protocol, setProtocol] = useState<SsoProtocol>('saml');
  const [metadata, setMetadata] = useState('');
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [defaultRole, setDefaultRole] = useState<'member' | 'guest' | 'admin'>('member');
  const [hours, setHours] = useState('24');
  const [owners, setOwners] = useState<WorkspaceMember[]>([]);
  const [breakGlass, setBreakGlass] = useState('');
  const [confirmEnforce, setConfirmEnforce] = useState(false);

  const load = useCallback(
    (next: SsoSettings) => {
      setS(next);
      const c = next.connection;
      if (c) {
        setProtocol(c.protocol);
        setDefaultRole(c.defaultRole);
        setHours(String(c.sessionHours));
        setIssuer(c.oidc?.issuer ?? '');
        setClientId(c.oidc?.clientId ?? '');
        if (c.breakGlassUserId) setBreakGlass(c.breakGlassUserId);
      }
    },
    [],
  );

  useEffect(() => {
    api.ssoSettings(workspace.id).then(load, (e) => notify(errorText(e, 'Could not load single sign-on'), 'error'));
    api.listWorkspaceMembers(workspace.id).then(({ members }) => setOwners(members.filter((m) => m.role === 'owner')), () => setOwners([]));
  }, [workspace.id, load, notify]);

  const run = async (key: string, fn: () => Promise<SsoSettings>, ok?: string) => {
    setBusy(key);
    try {
      load(await fn());
      if (ok) notify(ok, 'success');
    } catch (e) {
      notify(errorText(e, 'That didn’t work'), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!s) return null;
  const c = s.connection;
  const verified = s.domains.some((d) => d.verified);
  const owner = workspace.role === 'owner';

  const save = (e: FormEvent) => {
    e.preventDefault();
    void run(
      'save',
      () =>
        api.saveSsoConnection(workspace.id, {
          protocol,
          enabled: c?.enabled ?? false,
          defaultRole,
          sessionHours: Number(hours) || 24,
          // SAML without new metadata keeps the connected provider (the server keeps it).
          ...(protocol === 'saml' ? (metadata.trim() ? { samlMetadataXml: metadata } : {}) : { oidcIssuer: issuer, oidcClientId: clientId, oidcClientSecret: secret }),
        }),
      'Identity provider saved',
    ).then(() => {
      setMetadata('');
      setSecret('');
    });
  };

  return (
    <div className="fr-dash-settings__block" id="sso">
      <h2 className="fr-dash-settings__title">Single sign-on</h2>
      <p className="fr-dash-settings__hint">
        People with an address at a verified domain sign in through your identity provider (SAML 2.0 or OpenID Connect). Their first sign-in adds them to
        this workspace.
      </p>

      <h3 className="fr-dash-sso__sub">1. Verify your domains</h3>
      {s.domains.map((d) => (
        <div key={d.id} className="fr-dash-sso__domain">
          <div className="fr-dash-sso__domain-head">
            <strong>{d.domain}</strong>
            {d.verified ? (
              <span className="fr-dash-sso__badge fr-dash-sso__badge--ok">
                <CheckCircle2 size={14} aria-hidden /> Verified
              </span>
            ) : (
              <span className="fr-dash-sso__badge">Waiting for DNS</span>
            )}
            <span className="fr-dash-sso__spacer" />
            {!d.verified ? (
              <Button size="sm" icon={RefreshCw} loading={busy === `verify-${d.id}`} onClick={() => void run(`verify-${d.id}`, () => api.verifySsoDomain(workspace.id, d.id), `${d.domain} is verified`)}>
                Verify
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void run(`rm-${d.id}`, () => api.removeSsoDomain(workspace.id, d.id))}>
              Remove
            </Button>
          </div>
          {!d.verified ? (
            <div className="fr-dash-sso__txt">
              <span className="fr-dash-settings__hint">Add this TXT record at your DNS provider, then select Verify.</span>
              <CopyField label="Name" value={d.txtName} />
              <CopyField label="Value" value={d.txtValue} />
            </div>
          ) : null}
        </div>
      ))}
      <form
        className="fr-dash-settings__row"
        onSubmit={(e) => {
          e.preventDefault();
          if (domain.trim()) void run('add', () => api.addSsoDomain(workspace.id, domain.trim())).then(() => setDomain(''));
        }}
      >
        <Input aria-label="Domain" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
        <Button type="submit" loading={busy === 'add'} disabled={!domain.trim()}>
          Add domain
        </Button>
      </form>

      <h3 className="fr-dash-sso__sub">2. Connect your identity provider</h3>
      <div className="fr-dash-sso__sp">
        <span className="fr-dash-settings__hint">Give your identity provider these details for Freero:</span>
        {protocol === 'saml' ? (
          <>
            <CopyField label="Entity ID / metadata" value={s.serviceProvider.entityId} />
            <CopyField label="ACS (reply) URL" value={s.serviceProvider.acsUrl} />
            <CopyField label="Sign-in URL (app tile)" value={s.serviceProvider.startUrl} />
          </>
        ) : (
          <CopyField label="Redirect URI" value={s.serviceProvider.oidcRedirectUri} />
        )}
      </div>
      <form className="fr-dash-sso__form" onSubmit={save}>
        <SegmentedControl<SsoProtocol>
          aria-label="Protocol"
          options={[
            { value: 'saml', label: 'SAML 2.0' },
            { value: 'oidc', label: 'OpenID Connect' },
          ]}
          value={protocol}
          onChange={setProtocol}
        />
        {protocol === 'saml' ? (
          <>
            {c?.saml ? (
              <p className="fr-dash-settings__hint">
                Connected to <code>{c.saml.entityId}</code> · certificate valid until {new Date(c.saml.certificates[0]?.validTo ?? 0).toLocaleDateString()}. Paste new
                metadata to replace it.
              </p>
            ) : null}
            <TextArea label="Identity provider metadata (XML)" rows={5} value={metadata} onChange={(e) => setMetadata(e.target.value)} placeholder="<EntityDescriptor …>" />
          </>
        ) : (
          <>
            <Input label="Issuer URL" value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="https://login.example.com" />
            <Input label="Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
            <Input
              label="Client secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={c?.oidc?.hasClientSecret ? 'Stored — leave blank to keep it' : ''}
            />
          </>
        )}
        <div className="fr-dash-sso__pair">
          <label className="fr-dash-sso__inline">
            <span className="fr-dash-settings__label">New people join as</span>
            <Select aria-label="Default role" options={ROLE_OPTIONS} value={defaultRole} onChange={setDefaultRole} width={140} />
          </label>
          <Input label="Longest session (hours)" type="number" min={1} max={720} value={hours} onChange={(e) => setHours(e.target.value)} />
        </div>
        <div>
          <Button type="submit" variant="primary" loading={busy === 'save'} disabled={protocol === 'saml' ? !metadata.trim() && !c?.saml : !issuer.trim() || !clientId.trim()}>
            Save identity provider
          </Button>
        </div>
      </form>

      {c ? (
        <>
          <h3 className="fr-dash-sso__sub">3. Turn it on</h3>
          <div className="fr-dash-settings__policy">
            <div className="fr-dash-settings__policy-text">
              <span className="fr-dash-settings__label">Single sign-on</span>
              <span className="fr-dash-settings__hint">
                {verified ? 'People at your verified domains are sent to your identity provider when they log in.' : 'Verify a domain first.'}
                {c.testedAt ? ` Last sign-in through it: ${when(c.testedAt)}.` : ' Sign in through it once to test it.'}
              </span>
            </div>
            <Toggle
              aria-label="Single sign-on"
              checked={c.enabled}
              disabled={!verified}
              onChange={(on) =>
                void run('enable', () =>
                  api.saveSsoConnection(workspace.id, { protocol: c.protocol, enabled: on, defaultRole: c.defaultRole, sessionHours: c.sessionHours }),
                )
              }
            />
          </div>
          <div className="fr-dash-settings__policy">
            <div className="fr-dash-settings__policy-text">
              <span className="fr-dash-settings__label">
                <ShieldCheck size={15} aria-hidden /> Enforce single sign-on
              </span>
              <span className="fr-dash-settings__hint">
                Password, reset-link and personal Google/Microsoft sign-in stop working for your domains; signed-in browsers that didn’t use SSO are signed out.
                One owner keeps password sign-in to fix the connection if it ever breaks.
              </span>
            </div>
            <Toggle
              aria-label="Enforce single sign-on"
              checked={c.enforced}
              disabled={!owner || !c.enabled || (!c.enforced && !c.testedAt)}
              onChange={(on) => (on ? setConfirmEnforce(true) : void run('enforce', () => api.enforceSso(workspace.id, false, null), 'Single sign-on is no longer enforced'))}
            />
          </div>
        </>
      ) : null}

      <Modal
        open={confirmEnforce}
        onClose={() => setConfirmEnforce(false)}
        title="Enforce single sign-on?"
        width={460}
        footer={
          <>
            <Button onClick={() => setConfirmEnforce(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!breakGlass}
              loading={busy === 'enforce'}
              onClick={() =>
                void run('enforce', () => api.enforceSso(workspace.id, true, breakGlass), 'Single sign-on is enforced').then(() => setConfirmEnforce(false))
              }
            >
              Enforce
            </Button>
          </>
        }
      >
        <p className="fr-dash-sso__modal-text">Everyone at your verified domains will have to sign in through your identity provider. Choose the owner who keeps password sign-in (break-glass):</p>
        <Select<string>
          aria-label="Break-glass owner"
          options={[{ value: '', label: 'Choose an owner', disabled: true }, ...owners.map((m) => ({ value: m.userId, label: m.name, description: m.email }))]}
          value={breakGlass}
          onChange={setBreakGlass}
          width="100%"
        />
      </Modal>
    </div>
  );
}

// ---- Provisioning (SCIM) ----

export function ScimBlock({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [s, setS] = useState<ScimSettings | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.scimSettings(workspace.id).then(setS, (e) => notify(errorText(e, 'Could not load provisioning'), 'error'));
    api.listProjects(workspace.id).then(({ projects }) => setProjects(projects), () => setProjects([]));
  }, [workspace.id, notify]);

  if (!s) return null;
  const mappingOptions: SelectOption<string>[] = [
    { value: '', label: 'Nothing (just listed)' },
    { value: 'role:admin', label: 'Role: admin' },
    { value: 'role:member', label: 'Role: member' },
    { value: 'role:guest', label: 'Role: guest' },
    ...projects.map((p) => ({ value: `project:${p.id}`, label: `Project: ${p.name}` })),
  ];
  const mappingValue = (m: ScimGroupMapping | null) => (!m ? '' : m.kind === 'role' ? `role:${m.role}` : `project:${m.projectId}`);
  const toMapping = (v: string): ScimGroupMapping | null => {
    if (!v) return null;
    const [kind, rest] = v.split(':');
    return kind === 'role' ? { kind: 'role', role: rest as 'admin' | 'member' | 'guest' } : { kind: 'project', projectId: rest };
  };

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.createScimToken(workspace.id, `Token ${s.tokens.length + 1}`);
      setS(r.settings);
      setShown(r.token);
    } catch (e) {
      notify(errorText(e, 'Could not create a token'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fr-dash-settings__block" id="provisioning">
      <h2 className="fr-dash-settings__title">Provisioning (SCIM)</h2>
      <p className="fr-dash-settings__hint">
        Let Okta, Microsoft Entra ID or another directory add, update and remove people. Deactivating someone there removes them from this workspace at
        once and signs them out.
      </p>
      <CopyField label="SCIM base URL" value={s.baseUrl} />
      <p className="fr-dash-settings__hint">
        {s.provisioned.active === 1 ? '1 person' : `${s.provisioned.active} people`} provisioned
        {s.provisioned.deactivated ? ` · ${s.provisioned.deactivated} deactivated` : ''}.
      </p>
      <div className="fr-dash-sso__list">
        {s.tokens.map((t) => (
          <div key={t.id} className="fr-dash-sso__item">
            <KeyRound size={15} aria-hidden />
            <span>
              <strong>{t.label}</strong> <code>{t.prefix}…</code>
            </span>
            <span className="fr-dash-settings__hint fr-dash-sso__meta">Last used {when(t.lastUsedAt)}</span>
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void api.revokeScimToken(workspace.id, t.id).then(setS, (e) => notify(errorText(e, 'Could not revoke'), 'error'))}>
              Revoke
            </Button>
          </div>
        ))}
      </div>
      <Button icon={KeyRound} loading={busy} onClick={() => void create()}>
        Generate token
      </Button>
      {s.groups.length ? (
        <>
          <h3 className="fr-dash-sso__sub">Directory groups</h3>
          <p className="fr-dash-settings__hint">Choose what each group grants here. Once a group grants a role, the directory decides the roles of the people it provisioned (owners excepted).</p>
          {s.groups.map((g) => (
            <div key={g.id} className="fr-dash-settings__policy">
              <div className="fr-dash-settings__policy-text">
                <span className="fr-dash-settings__label">{g.displayName}</span>
                <span className="fr-dash-settings__hint">{g.memberCount === 1 ? '1 member' : `${g.memberCount} members`}</span>
              </div>
              <Select<string>
                aria-label={`What ${g.displayName} grants`}
                options={mappingOptions}
                value={mappingValue(g.mapping)}
                onChange={(v) => void api.mapScimGroup(workspace.id, g.id, toMapping(v)).then(setS, (e) => notify(errorText(e, 'Could not change the group'), 'error'))}
                width={220}
              />
            </div>
          ))}
        </>
      ) : null}
      <Modal open={shown !== null} onClose={() => setShown(null)} title="Your new provisioning token" width={480} footer={<Button variant="primary" onClick={() => setShown(null)}>Done</Button>}>
        <p className="fr-dash-sso__modal-text">Copy it into your directory now. It won’t be shown again.</p>
        {shown ? <CopyField label="Token" value={shown} /> : null}
      </Modal>
    </div>
  );
}

// ---- Data exports ----

export function ExportList({ exports }: { exports: DataExportInfo[] }) {
  if (!exports.length) return null;
  return (
    <div className="fr-dash-sso__list">
      {exports.map((e) => (
        <div key={e.id} className="fr-dash-sso__item">
          <span>{new Date(e.createdAt).toLocaleString()}</span>
          <span className="fr-dash-settings__hint fr-dash-sso__meta">
            {e.status === 'ready' ? `Ready · ${size(e.bytes)} · until ${new Date(e.expiresAt ?? 0).toLocaleDateString()}` : e.status === 'pending' || e.status === 'running' ? 'Preparing…' : e.status === 'expired' ? 'Expired' : 'Failed'}
          </span>
          {e.status === 'ready' ? (
            <a className="fr-dash-sso__download" href={`/api/exports/${encodeURIComponent(e.id)}/download`} download>
              <Download size={15} aria-hidden /> Download
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function WorkspaceDataBlock({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [exports, setExports] = useState<DataExportInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => api.workspaceExports(workspace.id).then(({ exports }) => setExports(exports), () => undefined), [workspace.id]);
  useEffect(() => void refresh(), [refresh]);
  const ask = async () => {
    setBusy(true);
    try {
      await api.requestWorkspaceExport(workspace.id);
      notify('Preparing the export. We’ll email you a link when it’s ready.', 'success');
      void refresh();
    } catch (e) {
      notify(errorText(e, 'Could not start the export'), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fr-dash-settings__block" id="data">
      <h2 className="fr-dash-settings__title">Export workspace data</h2>
      <p className="fr-dash-settings__hint">A ZIP of every board (as JSON and in Freero’s own format, with its images), the members, projects and settings. Only you can download it, for 7 days.</p>
      <ExportList exports={exports} />
      <Button icon={Download} loading={busy} onClick={() => void ask()}>
        Export workspace
      </Button>
    </div>
  );
}

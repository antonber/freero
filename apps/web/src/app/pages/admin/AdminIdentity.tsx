// Admin console tabs for the organization's identity: single sign-on (verified domains, the
// identity provider, "Enforce SSO"), provisioning (SCIM tokens and what directory groups grant),
// and the workspace's data export. The server enforces every rule; these only edit and explain.
// Session length is the Security tab's session policy: it applies to SSO sign-ins too.
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Copy, Download, KeyRound, RefreshCw, RotateCw, ShieldCheck, Trash2 } from 'lucide-react';
import { DOMAIN_CAPTURE_GRACE_DAYS } from '@freero/shared';
import type {
  AdminMember,
  DataExportInfo,
  DomainControlSettings,
  OrganisationWorkspace,
  ProjectSummary,
  ScimGroupMapping,
  ScimSettings,
  SsoProtocol,
  SsoSettings,
  WorkspaceSummary,
} from '@freero/shared';
import { Button, Input, Modal, SegmentedControl, Select, Spinner, TextArea, Toggle, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../../api/client';
import { t as tr } from './messages';
import './identity.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : 'never');
const size = (b: number | null) => (b === null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

function Row({ label, hint, children }: { label: ReactNode; hint: ReactNode; children: ReactNode }) {
  return (
    <div className="fr-admin-row">
      <div className="fr-admin-row__text">
        <span className="fr-admin-row__label">{label}</span>
        <span className="fr-admin-row__hint">{hint}</span>
      </div>
      <div className="fr-admin-row__control">{children}</div>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const notify = useToast();
  return (
    <div className="fr-admin-sso__copy">
      <span className="fr-admin-row__label">{label}</span>
      <code>{value}</code>
      <Button
        size="sm"
        variant="ghost"
        icon={Copy}
        onClick={() => void navigator.clipboard?.writeText(value).then(() => notify(tr('copied'), 'success'), () => notify(tr('couldNotCopy'), 'error'))}
      >{tr('copy')}</Button>
    </div>
  );
}

const ROLE_OPTIONS: SelectOption<'member' | 'guest' | 'admin'>[] = [
  { value: 'member', label: tr('member') },
  { value: 'guest', label: tr('guest') },
  { value: 'admin', label: tr('admin') },
];

/** How the identity tabs name where people land: a team workspace, or an organisation's directory (#108). */
const placeOf = (w: WorkspaceSummary) => (w.kind === 'organisation' ? 'the organisation' : 'this workspace');

// ---- Single sign-on ----

export function AdminSso({ workspace }: { workspace: WorkspaceSummary }) {
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
  const [owners, setOwners] = useState<AdminMember[]>([]);
  const [breakGlass, setBreakGlass] = useState('');
  const [confirmEnforce, setConfirmEnforce] = useState(false);

  const load = useCallback((next: SsoSettings) => {
    setS(next);
    const c = next.connection;
    if (c) {
      setProtocol(c.protocol);
      setDefaultRole(c.defaultRole);
      setIssuer(c.oidc?.issuer ?? '');
      setClientId(c.oidc?.clientId ?? '');
      if (c.breakGlassUserId) setBreakGlass(c.breakGlassUserId);
    }
  }, []);

  useEffect(() => {
    api.ssoSettings(workspace.id).then(load, (e) => notify(errorText(e, tr('couldNotLoadSingleSign')), 'error'));
    api.adminMembers(workspace.id).then(({ members }) => setOwners(members.filter((m) => m.role === 'owner')), () => setOwners([]));
  }, [workspace.id, load, notify]);

  const run = async (key: string, fn: () => Promise<SsoSettings>, ok?: string) => {
    setBusy(key);
    try {
      load(await fn());
      if (ok) notify(ok, 'success');
      return true;
    } catch (e) {
      notify(errorText(e, tr('thatDidnTWork')), 'error');
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (!s) return <Spinner />;
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
          // SAML without new metadata keeps the connected provider (the server keeps it).
          ...(protocol === 'saml' ? (metadata.trim() ? { samlMetadataXml: metadata } : {}) : { oidcIssuer: issuer, oidcClientId: clientId, oidcClientSecret: secret }),
        }),
      tr('identityProviderSaved'),
    ).then((ok) => {
      if (!ok) return;
      setMetadata('');
      setSecret('');
    });
  };

  return (
    <section aria-labelledby="admin-sso-title">
      <h1 id="admin-sso-title" className="fr-admin__title">{tr('singleSignOn')}</h1>
      <p className="fr-admin__intro">{tr('peopleWithAnAddressAt', { placeOf: placeOf(workspace) })}{workspace.kind === 'organisation' ? tr('whicheverOfItsWorkspacesThey') : ''}. Their sessions follow the{' '}
        <Link to={`?tab=security`}>{tr('sessionPolicy')}</Link>.
      </p>

      <div className="fr-admin-card">
        <h2 className="fr-admin-card__title">{tr('n1VerifyYourDomains')}</h2>
        {s.domains.map((d) => (
          <div key={d.id} className="fr-admin-sso__domain">
            <div className="fr-admin-sso__domain-head">
              <strong>{d.domain}</strong>
              {d.verified ? (
                <span className="fr-admin-pill fr-admin-pill--ok">
                  <CheckCircle2 size={13} aria-hidden />{' '}{tr('verified')}</span>
              ) : (
                <span className="fr-admin-pill fr-admin-pill--warn">{tr('waitingForDns')}</span>
              )}
              <span className="fr-admin-sso__spacer" />
              {!d.verified ? (
                <Button size="sm" icon={RefreshCw} loading={busy === `verify-${d.id}`} onClick={() => void run(`verify-${d.id}`, () => api.verifySsoDomain(workspace.id, d.id), `${d.domain} is verified`)}>{tr('verify')}</Button>
              ) : null}
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void run(`rm-${d.id}`, () => api.removeSsoDomain(workspace.id, d.id))}>{tr('remove')}</Button>
            </div>
            {!d.verified ? (
              <div className="fr-admin-sso__stack">
                <span className="fr-admin-row__hint">{tr('addThisTxtRecordAt')}</span>
                <CopyField label={tr('name')} value={d.txtName} />
                <CopyField label={tr('value')} value={d.txtValue} />
              </div>
            ) : null}
          </div>
        ))}
        <form
          className="fr-admin-sso__inline"
          onSubmit={(e) => {
            e.preventDefault();
            if (domain.trim()) void run('add', () => api.addSsoDomain(workspace.id, domain.trim())).then((ok) => ok && setDomain(''));
          }}
        >
          <Input aria-label={tr('domain')} placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
          <Button type="submit" loading={busy === 'add'} disabled={!domain.trim()}>{tr('addDomain')}</Button>
        </form>
      </div>

      {verified ? <AdminDomainControl workspace={workspace} key={s.domains.filter((d) => d.verified).map((d) => d.domain).join(',')} /> : null}

      <div className="fr-admin-card">
        <h2 className="fr-admin-card__title">{tr('n2ConnectYourIdentityProvider')}</h2>
        <div className="fr-admin-sso__stack">
          <span className="fr-admin-row__hint">{tr('giveYourIdentityProviderThese')}</span>
          {protocol === 'saml' ? (
            <>
              <CopyField label="Entity ID / metadata" value={s.serviceProvider.entityId} />
              <CopyField label="ACS (reply) URL" value={s.serviceProvider.acsUrl} />
              <CopyField label="Sign-in URL (app tile)" value={s.serviceProvider.startUrl} />
              {s.serviceProvider.sloUrl ? <CopyField label="Single logout URL" value={s.serviceProvider.sloUrl} /> : null}
            </>
          ) : (
            <CopyField label={tr('redirectUri')} value={s.serviceProvider.oidcRedirectUri} />
          )}
        </div>
        <form className="fr-admin-sso__form" onSubmit={save}>
          <SegmentedControl<SsoProtocol>
            aria-label={tr('protocol')}
            options={[
              { value: 'saml', label: tr('saml20') },
              { value: 'oidc', label: tr('openidConnect') },
            ]}
            value={protocol}
            onChange={setProtocol}
          />
          {protocol === 'saml' ? (
            <>
              {c?.saml ? (
                <span className="fr-admin-row__hint">{tr('connectedTo')}{' '}<code>{c.saml.entityId}</code>{' '}{tr('certificateValidUntilTolocaledatestringP', { toLocaleDateString: new Date(c.saml.certificates[0]?.validTo ?? 0).toLocaleDateString() })}</span>
              ) : null}
              <TextArea label={tr('identityProviderMetadataXml')} rows={5} value={metadata} onChange={(e) => setMetadata(e.target.value)} placeholder="<EntityDescriptor …>" />
            </>
          ) : (
            <>
              <Input label={tr('issuerUrl')} value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="https://login.example.com" />
              <Input label={tr('clientId')} value={clientId} onChange={(e) => setClientId(e.target.value)} />
              <Input
                label={tr('clientSecret')}
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={c?.oidc?.hasClientSecret ? tr('storedLeaveBlankToKeep') : ''}
              />
            </>
          )}
          <Row label={tr('newPeopleJoinAs')} hint={tr('roleOfPeopleWhoseFirst', { placeOf: placeOf(workspace) })}>
            <Select
              aria-label={tr('defaultRole')}
              options={ROLE_OPTIONS.map((o) => ({ ...o, disabled: o.value === 'guest' && workspace.kind === 'organisation' }))}
              value={defaultRole}
              onChange={setDefaultRole}
              width={160}
            />
          </Row>
          <div>
            <Button type="submit" variant="primary" loading={busy === 'save'} disabled={protocol === 'saml' ? !metadata.trim() && !c?.saml : !issuer.trim() || !clientId.trim()}>{tr('saveIdentityProvider')}</Button>
          </div>
        </form>
      </div>

      {c ? (
        <div className="fr-admin-card">
          <h2 className="fr-admin-card__title">{tr('n3TurnItOn')}</h2>
          <Row
            label={tr('singleSignOn')}
            hint={
              <>
                {verified ? tr('peopleAtYourVerifiedDomains') : tr('verifyADomainFirst')}
                {c.testedAt ? tr('lastSignInThroughIt', { when: when(c.testedAt) }) : tr('signInThroughItOnce')}
              </>
            }
          >
            <Toggle
              aria-label={tr('singleSignOn')}
              checked={c.enabled}
              disabled={!verified}
              onChange={(on) => void run('enable', () => api.saveSsoConnection(workspace.id, { protocol: c.protocol, enabled: on, defaultRole: c.defaultRole }))}
            />
          </Row>
          {c.protocol === 'saml' ? (
            <Row
              label={tr('allowSignInFromThe')}
              hint={tr('peopleCanOpenFreeroFrom')}
            >
              <Toggle
                aria-label={tr('allowSignInFromThe')}
                checked={c.idpInitiated}
                onChange={(on) =>
                  void run(
                    'idp',
                    () => api.saveSsoConnection(workspace.id, { protocol: c.protocol, enabled: c.enabled, defaultRole: c.defaultRole, idpInitiated: on }),
                    on ? tr('signInFromTheIdentity') : tr('signInFromTheIdentity2'),
                  )
                }
              />
            </Row>
          ) : null}
          <Row
            label={
              <>
                <ShieldCheck size={14} aria-hidden />{' '}{tr('enforceSingleSignOn')}</>
            }
            hint={tr('passwordResetLinkAndPersonal')}
          >
            <Toggle
              aria-label={tr('enforceSingleSignOn')}
              checked={c.enforced}
              disabled={!owner || !c.enabled || (!c.enforced && !c.testedAt)}
              onChange={(on) => (on ? setConfirmEnforce(true) : void run('enforce', () => api.enforceSso(workspace.id, false, null), tr('singleSignOnIsNo')))}
            />
          </Row>
        </div>
      ) : null}

      {c?.protocol === 'saml' && c.saml ? <SamlKeysCard workspace={workspace} settings={s} busy={busy} run={run} /> : null}

      <Modal
        open={confirmEnforce}
        onClose={() => setConfirmEnforce(false)}
        title={tr('enforceSingleSignOn2')}
        width={460}
        footer={
          <>
            <Button onClick={() => setConfirmEnforce(false)}>{tr('cancel')}</Button>
            <Button
              variant="primary"
              disabled={!breakGlass}
              loading={busy === 'enforce'}
              onClick={() => void run('enforce', () => api.enforceSso(workspace.id, true, breakGlass), tr('singleSignOnIsEnforced')).then((ok) => ok && setConfirmEnforce(false))}
            >{tr('enforce')}</Button>
          </>
        }
      >
        <p className="fr-admin-sso__modal-text">{tr('everyoneAtYourVerifiedDomains')}</p>
        <Select<string>
          aria-label={tr('breakGlassOwner')}
          options={[{ value: '', label: tr('chooseAnOwner'), disabled: true }, ...owners.map((m) => ({ value: m.userId, label: m.name, description: m.email }))]}
          value={breakGlass}
          onChange={setBreakGlass}
          width="100%"
        />
      </Modal>
    </section>
  );
}

// ---- SAML keys and single logout (#13) ----

/** The certificate as a file to hand to the identity provider. */
function downloadCertificate(pem: string, fingerprint: string) {
  const url = URL.createObjectURL(new Blob([`${pem}\n`], { type: 'application/x-pem-file' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `freero-sp-${fingerprint.replace(/:/g, '').slice(0, 12).toLowerCase()}.crt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SamlKeysCard({
  workspace,
  settings: s,
  busy,
  run,
}: {
  workspace: WorkspaceSummary;
  settings: SsoSettings;
  busy: string | null;
  run: (key: string, fn: () => Promise<SsoSettings>, ok?: string) => Promise<boolean>;
}) {
  const c = s.connection!;
  const saml = c.saml!;
  const keys = s.spKeys ?? [];
  const [slo, setSlo] = useState(saml.sloUrl ?? '');
  useEffect(() => setSlo(saml.sloUrl ?? ''), [saml.sloUrl]);
  const base = { protocol: c.protocol, enabled: c.enabled, defaultRole: c.defaultRole };
  return (
    <div className="fr-admin-card">
      <h2 className="fr-admin-card__title">Signing, encryption and single logout</h2>
      <div className="fr-admin-sso__stack">
        <span className="fr-admin-row__hint">
          Freero’s own key pair for this {workspace.kind === 'organisation' ? 'organisation' : 'workspace'}: your identity provider encrypts assertions to its certificate and checks Freero’s signed
          requests with it. The certificate is in Freero’s metadata; the private key never leaves the server. To rotate, add a second key, give its certificate to your identity provider, make it
          current, then remove the old one. Both keys decrypt until then.
        </span>
        {keys.map((k) => (
          <div key={k.id} className="fr-admin-sso__domain">
            <div className="fr-admin-sso__domain-head">
              <KeyRound size={14} aria-hidden />
              <code title={k.fingerprint}>{k.fingerprint.slice(0, 23)}…</code>
              <span className={`fr-admin-pill ${k.current ? 'fr-admin-pill--ok' : 'fr-admin-pill--warn'}`}>{k.current ? 'Current' : 'Next'}</span>
              <span className="fr-admin-row__hint">valid until {new Date(k.validTo).toLocaleDateString()}</span>
              <span className="fr-admin-sso__spacer" />
              <Button size="sm" variant="ghost" icon={Download} onClick={() => downloadCertificate(k.certificate, k.fingerprint)}>
                Certificate
              </Button>
              {!k.current ? (
                <Button size="sm" icon={RotateCw} loading={busy === `promote-${k.id}`} onClick={() => void run(`promote-${k.id}`, () => api.promoteSsoSpKey(workspace.id, k.id), 'This key now signs requests')}>
                  Make current
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" icon={Trash2} loading={busy === `rmkey-${k.id}`} onClick={() => void run(`rmkey-${k.id}`, () => api.removeSsoSpKey(workspace.id, k.id), 'Key removed')}>
                Remove
              </Button>
            </div>
          </div>
        ))}
        {keys.length < 2 ? (
          <div>
            <Button icon={KeyRound} loading={busy === 'newkey'} onClick={() => void run('newkey', () => api.createSsoSpKey(workspace.id), keys.length ? 'Next key added: give its certificate to your identity provider' : 'Key created')}>
              {keys.length ? 'Add the next key' : 'Create a key'}
            </Button>
          </div>
        ) : null}
      </div>
      <Row label="Require encrypted assertions" hint="Sign-ins whose assertion isn’t encrypted to one of these keys are refused. Turn on once your identity provider encrypts.">
        <Toggle
          aria-label="Require encrypted assertions"
          checked={!!saml.requireEncryptedAssertions}
          disabled={!keys.length}
          onChange={(on) => void run('encrypt', () => api.saveSsoConnection(workspace.id, { ...base, requireEncryptedAssertions: on }))}
        />
      </Row>
      <Row label="Sign requests" hint="Sign-in and logout requests are signed with the current key (for identity providers that want signed requests).">
        <Toggle aria-label="Sign requests" checked={!!saml.signRequests} disabled={!keys.length} onChange={(on) => void run('sign', () => api.saveSsoConnection(workspace.id, { ...base, signRequests: on }))} />
      </Row>
      <form
        className="fr-admin-sso__form"
        onSubmit={(e) => {
          e.preventDefault();
          void run('slo', () => api.saveSsoConnection(workspace.id, { ...base, samlSloUrl: slo.trim() }), slo.trim() ? 'Single logout is on' : 'Single logout is off');
        }}
      >
        <Input
          label="Identity provider’s single logout URL"
          value={slo}
          onChange={(e) => setSlo(e.target.value)}
          placeholder="Read from its metadata, or https://…"
          hint="When set, signing out of Freero also signs out at your identity provider, and its logout signs people out of Freero."
        />
        <div>
          <Button type="submit" loading={busy === 'slo'} disabled={slo.trim() === (saml.sloUrl ?? '')}>
            Save single logout
          </Button>
        </div>
      </form>
    </div>
  );
}

// ---- Domain control (#64): accounts at the verified domains, with or without SSO ----

const GRACE_OPTIONS: SelectOption<number>[] = DOMAIN_CAPTURE_GRACE_DAYS.map((d) => ({ value: d, label: tr('inDDays', { d }) }));

function AdminDomainControl({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [s, setS] = useState<DomainControlSettings | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [grace, setGrace] = useState<number>(14);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.domainControl(workspace.id).then(setS, (e) => notify(errorText(e, tr('couldNotLoadDomainControl')), 'error'));
  }, [workspace.id, notify]);

  const run = async (key: string, fn: () => Promise<DomainControlSettings>, ok?: string) => {
    setBusy(key);
    try {
      setS(await fn());
      if (ok) notify(ok, 'success');
    } catch (e) {
      notify(errorText(e, tr('thatDidnTWork')), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!s) return null;
  const outside = s.accounts.filter((a) => a.status === 'outside');
  const domains = s.domains.join(', ');
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="fr-admin-card">
      <h2 className="fr-admin-card__title">{tr('domainControl')}</h2>
      <p className="fr-admin-row__hint">{tr('forAccountsAtDomainsWorks', { domains, placeOf: placeOf(workspace) })}</p>
      <Row label={tr('addNewSignUpsTo', { placeOf: placeOf(workspace) })} hint={tr('anyoneWhoConfirmsAnAddress', { domains, placeOf: placeOf(workspace) })}>
        <Toggle
          aria-label={tr('addNewSignUpsTo', { placeOf: placeOf(workspace) })}
          checked={s.captureSignups}
          disabled={busy === 'capture'}
          onChange={(on) => void run('capture', () => api.setDomainControl(workspace.id, { captureSignups: on }))}
        />
      </Row>
      <Row label={tr('blockOtherTeamWorkspaces')} hint={tr('peopleAtDomainsCanT', { domains, placeOf: placeOf(workspace) })}>
        <Toggle
          aria-label={tr('blockOtherTeamWorkspaces')}
          checked={s.blockWorkspaces}
          disabled={busy === 'block'}
          onChange={(on) => void run('block', () => api.setDomainControl(workspace.id, { blockWorkspaces: on }))}
        />
      </Row>
      <h3 className="fr-admin-domain__heading">{tr('accountsAtYourDomains')}</h3>
      {s.accounts.length === 0 ? (
        <p className="fr-admin-row__hint">{tr('noFreeroAccountHasConfirmed', { domains })}</p>
      ) : (
        <>
          <ul className="fr-admin-domain__list">
            {s.accounts.map((a) => (
              <li key={a.userId} className="fr-admin-domain__item">
                {a.status === 'outside' ? (
                  <input type="checkbox" aria-label={tr('addName', { name: a.name })} checked={picked.has(a.userId)} onChange={() => toggle(a.userId)} />
                ) : (
                  <span className="fr-admin-domain__check" aria-hidden />
                )}
                <span className="fr-admin-domain__who">
                  <strong>{a.name}</strong>
                  <span className="fr-admin-row__hint">{a.email}</span>
                </span>
                {a.status === 'member' ? (
                  <span className="fr-admin-pill fr-admin-pill--ok">{tr('member')}</span>
                ) : a.status === 'pending' ? (
                  <>
                    <span className="fr-admin-pill fr-admin-pill--warn">{tr('joins')}{' '}{a.joinsAt ? new Date(a.joinsAt).toLocaleDateString() : 'soon'}</span>
                    <Button size="sm" variant="ghost" loading={busy === `cancel-${a.userId}`} onClick={() => void run(`cancel-${a.userId}`, () => api.cancelDomainCapture(workspace.id, a.userId))}>{tr('cancel')}</Button>
                  </>
                ) : (
                  <span className="fr-admin-pill fr-admin-pill--off">{tr('notInThisWorkspace')}</span>
                )}
              </li>
            ))}
          </ul>
          {outside.length ? (
            <div className="fr-admin-domain__actions">
              <Button size="sm" variant="ghost" onClick={() => setPicked(picked.size === outside.length ? new Set() : new Set(outside.map((a) => a.userId)))}>
                {picked.size === outside.length ? tr('selectNone') : tr('selectAll')}
              </Button>
              <Select<number> aria-label={tr('whenTheyJoin')} options={GRACE_OPTIONS} value={grace} onChange={setGrace} width={140} />
              <Button
                variant="primary"
                disabled={!picked.size}
                loading={busy === 'add'}
                onClick={() =>
                  void run('add', async () => {
                    const r = await api.captureDomainAccounts(workspace.id, [...picked], grace);
                    setPicked(new Set());
                    notify(tr('startedPeopleWereEmailedAnd', { started: r.started, grace }), 'success');
                    return r;
                  })
                }
              >{tr('add')}{' '}{picked.size || ''}{' '}{tr('toTheWorkspace')}</Button>
            </div>
          ) : null}
          <p className="fr-admin-row__hint">{tr('eachPersonIsEmailedWhen')}</p>
        </>
      )}
    </div>
  );
}

// ---- Provisioning (SCIM) ----

export function AdminProvisioning({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [s, setS] = useState<ScimSettings | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  // An organisation's groups grant membership of its workspaces instead of projects (#108).
  const [teams, setTeams] = useState<OrganisationWorkspace[]>([]);
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const org = workspace.kind === 'organisation';

  useEffect(() => {
    api.scimSettings(workspace.id).then(setS, (e) => notify(errorText(e, tr('couldNotLoadProvisioning')), 'error'));
    if (org) api.organisationWorkspaces(workspace.id).then(({ workspaces }) => setTeams(workspaces), () => setTeams([]));
    else api.listProjects(workspace.id).then(({ projects }) => setProjects(projects), () => setProjects([]));
  }, [workspace.id, notify, org]);

  if (!s) return <Spinner />;
  const mappingOptions: SelectOption<string>[] = [
    { value: '', label: tr('nothingJustListed') },
    { value: 'role:admin', label: org ? tr('organisationAdmin') : tr('roleAdmin') },
    { value: 'role:member', label: org ? tr('organisationMember') : tr('roleMember') },
    ...(org ? [] : [{ value: 'role:guest', label: tr('roleGuest') }]),
    ...projects.map((p) => ({ value: `project:${p.id}`, label: tr('projectName', { name: p.name }) })),
    ...teams.flatMap((t) => [
      { value: `workspace:${t.id}:member`, label: tr('nameMember', { name: t.name }) },
      { value: `workspace:${t.id}:admin`, label: tr('nameAdmin', { name: t.name }) },
    ]),
  ];
  const mappingValue = (m: ScimGroupMapping | null) =>
    !m ? '' : m.kind === 'role' ? `role:${m.role}` : m.kind === 'project' ? `project:${m.projectId}` : `workspace:${m.workspaceId}:${m.role}`;
  const toMapping = (v: string): ScimGroupMapping | null => {
    if (!v) return null;
    const [kind, rest, role] = v.split(':');
    if (kind === 'workspace') return { kind: 'workspace', workspaceId: rest, role: role as 'admin' | 'member' };
    return kind === 'role' ? { kind: 'role', role: rest as 'admin' | 'member' | 'guest' } : { kind: 'project', projectId: rest };
  };

  const issue = async (fn: () => Promise<{ token: string; settings: ScimSettings }>) => {
    setBusy(true);
    try {
      const r = await fn();
      setS(r.settings);
      setShown(r.token);
    } catch (e) {
      notify(errorText(e, tr('couldNotMakeAToken')), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="admin-scim-title">
      <h1 id="admin-scim-title" className="fr-admin__title">{tr('provisioning')}</h1>
      <p className="fr-admin__intro">{tr('letOktaMicrosoftEntraId')}</p>

      <div className="fr-admin-card">
        <h2 className="fr-admin-card__title">{tr('connection')}</h2>
        <CopyField label={tr('scimBaseUrl')} value={s.baseUrl} />
        <p className="fr-admin-card__note">{tr('activePeopleProvisioned', { active: s.provisioned.active })}{s.provisioned.deactivated ? tr('deactivatedDeactivatedByTheDirectory', { deactivated: s.provisioned.deactivated }) : ''}.
        </p>
        <div className="fr-admin-sso__list">
          {s.tokens.map((t) => (
            <div key={t.id} className="fr-admin-sso__item">
              <KeyRound size={15} aria-hidden />
              <span>
                <strong>{t.label}</strong> <code>{t.prefix}…</code>
              </span>
              <span className="fr-admin-row__hint fr-admin-sso__meta">{tr('lastUsedWhen', { when: when(t.lastUsedAt) })}</span>
              <Button size="sm" variant="ghost" icon={RotateCw} onClick={() => void issue(() => api.rotateScimToken(workspace.id, t.id))}>{tr('rotate')}</Button>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void api.revokeScimToken(workspace.id, t.id).then(setS, (e) => notify(errorText(e, tr('couldNotRevoke')), 'error'))}>{tr('revoke')}</Button>
            </div>
          ))}
        </div>
        <div>
          <Button icon={KeyRound} loading={busy} onClick={() => void issue(() => api.createScimToken(workspace.id, `Token ${s.tokens.length + 1}`))}>{tr('generateToken')}</Button>
        </div>
      </div>

      {s.groups.length ? (
        <div className="fr-admin-card">
          <h2 className="fr-admin-card__title">{tr('directoryGroups')}</h2>
          {s.groups.map((g) => (
            <Row key={g.id} label={g.displayName} hint={tr('membercountMembers', { memberCount: g.memberCount })}>
              <Select<string>
                aria-label={tr('whatDisplaynameGrants', { displayName: g.displayName })}
                options={mappingOptions}
                value={mappingValue(g.mapping)}
                onChange={(v) => void api.mapScimGroup(workspace.id, g.id, toMapping(v)).then(setS, (e) => notify(errorText(e, tr('couldNotChangeTheGroup')), 'error'))}
                width={230}
              />
            </Row>
          ))}
          <p className="fr-admin-card__note">{tr('onceAGroupGrantsA')}{org
              ? tr('aGroupThatGrantsA')
              : ''}
          </p>
        </div>
      ) : null}

      <Modal open={shown !== null} onClose={() => setShown(null)} title={tr('yourNewProvisioningToken')} width={480} footer={<Button variant="primary" onClick={() => setShown(null)}>{tr('done')}</Button>}>
        <p className="fr-admin-sso__modal-text">{tr('copyItIntoYourDirectory')}</p>
        {shown ? <CopyField label={tr('token')} value={shown} /> : null}
      </Modal>
    </section>
  );
}

// ---- Data exports ----

export function ExportList({ exports }: { exports: DataExportInfo[] }) {
  if (!exports.length) return null;
  return (
    <div className="fr-admin-sso__list">
      {exports.map((e) => (
        <div key={e.id} className="fr-admin-sso__item">
          <span>{new Date(e.createdAt).toLocaleString()}</span>
          <span className="fr-admin-row__hint fr-admin-sso__meta">
            {e.status === 'ready'
              ? tr('readySizeUntilTolocaledatestring', { size: size(e.bytes), toLocaleDateString: new Date(e.expiresAt ?? 0).toLocaleDateString() })
              : e.status === 'pending' || e.status === 'running'
                ? tr('preparing')
                : e.status === 'expired'
                  ? tr('expired')
                  : tr('failed')}
          </span>
          {e.status === 'ready' ? (
            <a className="fr-admin-sso__download" href={`/api/exports/${encodeURIComponent(e.id)}/download`} download>
              <Download size={15} aria-hidden />{' '}{tr('download')}</a>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function AdminDataExport({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [exports, setExports] = useState<DataExportInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => api.workspaceExports(workspace.id).then(({ exports }) => setExports(exports), () => undefined), [workspace.id]);
  useEffect(() => void refresh(), [refresh]);
  const ask = async () => {
    setBusy(true);
    try {
      await api.requestWorkspaceExport(workspace.id);
      notify(tr('preparingTheExportWeLl'), 'success');
      void refresh();
    } catch (e) {
      notify(errorText(e, tr('couldNotStartTheExport')), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fr-admin-card" id="data">
      <h2 className="fr-admin-card__title">{tr('exportWorkspaceData')}</h2>
      <p className="fr-admin-card__note">{tr('aZipOfEveryBoard')}</p>
      <ExportList exports={exports} />
      <div>
        <Button icon={Download} loading={busy} onClick={() => void ask()}>{tr('exportWorkspace')}</Button>
      </div>
    </div>
  );
}

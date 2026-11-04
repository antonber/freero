// /settings/connect — "Connect an agent" (#80): this instance's MCP address with, per client, the
// one click or one paste it takes; a personal token for plain HTTP; starter prompts; and what is
// connected now, marked "Connected" once its client has called the server. Linked from settings,
// the dashboard's empty state and the board menu (`?board=<id>` fills that board into the prompts).
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, CircleAlert, Copy, ExternalLink, KeyRound, Plug, Trash2 } from 'lucide-react';
import type { ApiScope, AuthorizedApp, McpConnectInfo, PersonalToken } from '@freero/shared';
import { API_SCOPES } from '@freero/shared';
import { Button, Input, Logo, Select, Spinner, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { relativeTime } from '../../lib/time';
import { EXPIRY, OFFERED, Scopes } from '../account/ApiSections';
import { Section } from '../account/Section';
import { CLIENTS, clientFromHash, clientSetup, curlExamples, reachableFromTheInternet, type ClientId, type SetupBlock } from './clients';
import { connectionStates, type Connection } from './connections';
import { starterPrompts } from './prompts';
import { t as tr } from './messages';
import '../account/account.css';
import '../account/api.css';
import './connect.css';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError && err.status < 500 ? err.message : fallback);
/** How often the list looks for a client's first call while the page is open. */
const POLL_MS = 4000;

function useCopy() {
  const notify = useToast();
  return (text: string, what = 'Copied') => {
    if (!navigator.clipboard) return notify(tr('yourBrowserDoesnTAllow'), 'error');
    navigator.clipboard.writeText(text).then(
      () => notify(what, 'success'),
      () => notify(tr('couldNotCopySelectThe'), 'error'),
    );
  };
}

/** A value to copy: one line (an address, a command) or a block (a config file). */
function CopyField({ label, value, block }: { label: string; value: string; block?: boolean }) {
  const copy = useCopy();
  return (
    <div className="fr-connect-copy">
      <span className="fr-connect-copy__label">{label}</span>
      <div className={`fr-connect-copy__row${block ? ' fr-connect-copy__row--block' : ''}`}>
        {block ? <pre className="fr-connect-copy__value">{value}</pre> : <code className="fr-connect-copy__value">{value}</code>}
        <Button size="sm" icon={Copy} onClick={() => copy(value, `${label} copied`)} aria-label={tr('copyLabel', { label: label.toLowerCase() })}>{tr('copy')}</Button>
      </div>
    </div>
  );
}

export function ConnectAgentPage() {
  useEffect(() => {
    document.title = 'Connect an agent · Freero';
  }, []);
  const [info, setInfo] = useState<McpConnectInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.mcpConnectInfo().then(setInfo, () => setFailed(true));
  }, []);
  const [params] = useSearchParams();
  const boardId = params.get('board');
  const origin = info ? info.mcpUrl.replace(/\/mcp$/, '') : '';
  const boardLink = boardId && origin ? `${origin}/board/${encodeURIComponent(boardId)}` : null;
  const [connectionsVersion, setConnectionsVersion] = useState(0);

  return (
    <div className="fr-acct">
      <header className="fr-acct__top">
        <Link to="/settings" className="fr-acct__back">
          <ArrowLeft size={16} aria-hidden />{' '}{tr('settings')}</Link>
        <Logo size={26} withWordmark />
      </header>
      <main className="fr-acct__main">
        <h1 className="fr-acct__title">{tr('connectAnAgent')}</h1>
        <p className="fr-connect-lead">{tr('letClaudeChatgptYourCoding')}{' '}<Link to="/apps">{tr('appsAgents')}</Link>.
        </p>
        {failed ? (
          <p className="fr-acct__error">{tr('couldNotLoadThisServer')}</p>
        ) : !info ? (
          <Spinner size={20} label={tr('loading')} />
        ) : !info.enabled ? (
          <Section id="connect-off" title={tr('agentsAreTurnedOffHere')}>
            <p className="fr-acct__p">{tr('theOperatorOfThisFreero')}</p>
          </Section>
        ) : (
          <>
            <Section id="connect-address" title={tr('yourFreeroMcpServer')} description={tr('everyMcpClientConnectsTo')}>
              <CopyField label={tr('mcpServerUrl')} value={info.mcpUrl} />
              {!reachableFromTheInternet(info.mcpUrl) ? (
                <p className="fr-connect-warn" role="note">
                  <CircleAlert size={15} aria-hidden />{' '}{tr('thisAddressIsnTPublic')}</p>
              ) : null}
            </Section>
            <ClientTabs info={info} onTokenCreated={() => setConnectionsVersion((v) => v + 1)} />
            <ConnectionsSection version={connectionsVersion} />
            <PromptsSection board={boardLink} />
          </>
        )}
      </main>
    </div>
  );
}

function ClientTabs({ info, onTokenCreated }: { info: McpConnectInfo; onTokenCreated: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const active = clientFromHash(location.hash);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const select = (id: ClientId, focus = false) => {
    navigate({ search: location.search, hash: id }, { replace: true });
    if (focus) tabs.current[CLIENTS.findIndex((c) => c.id === id)]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    // From the focused tab: the URL (and so `active`) may not have caught up with the last click yet.
    const focused = tabs.current.indexOf(e.target as HTMLButtonElement);
    const i = focused >= 0 ? focused : CLIENTS.findIndex((c) => c.id === active);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? CLIENTS.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    select(CLIENTS[(next + CLIENTS.length) % CLIENTS.length].id, true);
  };
  const client = CLIENTS.find((c) => c.id === active)!;

  return (
    <section className="fr-acct-card" aria-labelledby="connect-clients-title">
      <header className="fr-acct-card__head">
        <h2 id="connect-clients-title">{tr('pickYourClient')}</h2>
        <p>{tr('theStepsForEachWith')}</p>
      </header>
      <div className="fr-connect-tabs" role="tablist" aria-label={tr('client')} onKeyDown={onKey}>
        {CLIENTS.map((c, i) => (
          <button
            key={c.id}
            ref={(el) => (tabs.current[i] = el)}
            type="button"
            role="tab"
            id={`connect-tab-${c.id}`}
            aria-controls="connect-panel"
            aria-selected={c.id === active}
            tabIndex={c.id === active ? 0 : -1}
            className="fr-connect-tab"
            onClick={() => select(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="fr-connect-panel" role="tabpanel" id="connect-panel" aria-labelledby={`connect-tab-${active}`} data-testid={`connect-panel-${active}`}>
        {active === 'http' ? (
          <HttpClientPanel apiUrl={info.apiUrl} onCreated={onTokenCreated} />
        ) : (
          <SetupSteps blocks={clientSetup(active, info.mcpUrl)} intro={client.intro} />
        )}
      </div>
    </section>
  );
}

/** One client's setup: numbered steps, each with text and maybe a command, a config or a link. */
function SetupSteps({ blocks, intro }: { blocks: SetupBlock[]; intro: string | null }) {
  return (
    <>
      {intro ? <p className="fr-acct__p">{intro}</p> : null}
      <ol className="fr-connect-steps">
        {blocks.map((b, i) => (
          <li key={i} className="fr-connect-step">
            <p className="fr-connect-step__text">{b.text}</p>
            {b.copy ? <CopyField label={b.copy.label} value={b.copy.value} block={b.copy.value.includes('\n')} /> : null}
            {b.link ? (
              <a className="fr-connect-install" href={b.link.href} data-testid="install-link">
                <ExternalLink size={16} aria-hidden /> {b.link.label}
              </a>
            ) : null}
          </li>
        ))}
      </ol>
    </>
  );
}

/** Any HTTP client: a personal token made right here (shown once) and the first calls with it. */
function HttpClientPanel({ apiUrl, onCreated }: { apiUrl: string; onCreated: () => void }) {
  const [name, setName] = useState('My script');
  const [scopes, setScopes] = useState<ApiScope[]>(['boards:read']);
  const [expiry, setExpiry] = useState('30');
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(tr('giveTheTokenAName'));
    if (!scopes.length) return setError(tr('pickAtLeastOnePermission'));
    setBusy(true);
    setError(null);
    try {
      const out = await api.createApiToken({ name: name.trim(), scopes, expiresInDays: expiry === 'never' ? null : Number(expiry) });
      setSecret(out.secret);
      onCreated();
    } catch (err) {
      setError(errorText(err, tr('couldNotCreateTheToken')));
    } finally {
      setBusy(false);
    }
  };
  const examples = curlExamples(apiUrl, secret ?? 'frp_…');
  return (
    <>
      <p className="fr-acct__p">{tr('scriptsCiJobsAndAgents')}</p>
      {secret ? (
        <div className="fr-acct-api__secret" role="status">
          <p className="fr-acct__p">{tr('thisIsYourNewToken')}</p>
          <CopyField label={tr('token')} value={secret} />
          <div className="fr-acct-form__row">
            <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>{tr('done')}</Button>
          </div>
        </div>
      ) : (
        <form className="fr-acct-form" onSubmit={create} noValidate>
          <div className="fr-acct-form__grid">
            <Input label={tr('tokenName')} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            <div className="fr-acct-api__field">
              <span className="fr-acct-api__label">{tr('expires')}</span>
              <Select options={EXPIRY} value={expiry} onChange={setExpiry} aria-label={tr('expires')} />
            </div>
          </div>
          <fieldset className="fr-acct-api__perms">
            <legend className="fr-acct-api__label">{tr('permissions')}</legend>
            {OFFERED.map((s) => (
              <label key={s} className="fr-acct-api__perm">
                <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))} />
                <span>
                  <code>{s}</code> {API_SCOPES[s]}
                </span>
              </label>
            ))}
          </fieldset>
          {error ? (
            <p className="fr-acct__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="fr-acct-form__row">
            <Button type="submit" variant="primary" icon={KeyRound} loading={busy}>{tr('createToken')}</Button>
          </div>
        </form>
      )}
      {examples.map((x) => (
        <CopyField key={x.label} label={x.label} value={x.value} block />
      ))}
    </>
  );
}

/** Connected apps and tokens, refreshed while the page is open so a client's first call shows up. */
function ConnectionsSection({ version }: { version: number }) {
  const notify = useToast();
  const [apps, setApps] = useState<AuthorizedApp[] | null>(null);
  const [tokens, setTokens] = useState<PersonalToken[] | null>(null);
  const [failed, setFailed] = useState(false);
  const seen = useRef<Map<string, boolean> | null>(null);
  const load = useCallback(() => {
    Promise.all([api.listAuthorizedApps(), api.listApiTokens()]).then(
      ([a, t]) => {
        setApps(a.apps);
        setTokens(t.tokens);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);
  useEffect(load, [load, version]);
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const list: Connection[] | null = useMemo(() => (apps && tokens ? connectionStates(apps, tokens) : null), [apps, tokens]);
  // A client that made its first call while the page was open: say so once.
  useEffect(() => {
    if (!list) return;
    const before = seen.current;
    seen.current = new Map(list.map((c) => [c.key, c.connected]));
    if (!before) return;
    for (const c of list) if (c.connected && before.get(c.key) !== true) notify(tr('nameIsConnected', { name: c.name }), 'success');
  }, [list, notify]);

  const revoke = async (c: Connection) => {
    try {
      if (c.kind === 'app') await api.revokeAuthorizedApp(c.id);
      else await api.revokeApiToken(c.id);
      notify(c.kind === 'app' ? tr('nameCanNoLongerUse', { name: c.name }) : tr('revokedName', { name: c.name }), 'info');
      load();
    } catch (err) {
      notify(errorText(err, tr('couldNotRevokeIt')), 'error');
    }
  };

  return (
    <Section id="connections" title={tr('connectedNow')} description={tr('appsYouAllowedAndTokens')}>
      {failed && !list ? (
        <p className="fr-acct__error">{tr('couldNotLoadYourConnections')}</p>
      ) : !list ? (
        <Spinner size={20} label={tr('loadingConnections')} />
      ) : list.length ? (
        <ul className="fr-acct-sessions" aria-live="polite">
          {list.map((c) => (
            <li key={c.key} className="fr-acct-session" data-testid="connection-row">
              <span className="fr-acct-session__icon" aria-hidden>
                {c.kind === 'app' ? <Plug size={18} /> : <KeyRound size={18} />}
              </span>
              <span className="fr-acct-session__who">
                <span className="fr-acct-session__device">{c.name}</span>
                <span className="fr-connect-status">
                  {c.connected ? (
                    <span className="fr-acct-badge fr-acct-badge--ok" data-testid="connected-badge">
                      <Check size={13} aria-hidden />{' '}{tr('connected')}</span>
                  ) : c.problem ? (
                    <span className="fr-acct-badge fr-acct-badge--warn">{c.problem}</span>
                  ) : (
                    <span className="fr-connect-waiting">{tr('waitingForItsFirstCall')}</span>
                  )}
                </span>
                <Scopes scopes={c.scopes} />
                <span className="fr-acct-session__meta">{[c.via, c.lastUsedAt ? `last used ${relativeTime(c.lastUsedAt)}` : null, `added ${relativeTime(c.addedAt)}`].filter(Boolean).join(' · ')}</span>
              </span>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => revoke(c)} aria-label={tr('revokeName', { name: c.name })}>{tr('revoke')}</Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fr-acct__p">{tr('nothingIsConnectedYetFollow')}</p>
      )}
      <p className="fr-acct__hint">{tr('pauseTokensRegisterYourOwn')}{' '}<Link to="/settings#connected-apps">{tr('settings')}</Link>.
      </p>
    </Section>
  );
}

function PromptsSection({ board }: { board: string | null }) {
  const copy = useCopy();
  return (
    <Section id="prompts" title={tr('tryIt')} description={tr('onceConnectedPasteOneOf')}>
      <ul className="fr-connect-prompts">
        {starterPrompts(board).map((p) => (
          <li key={p.id} className="fr-connect-prompt">
            <div className="fr-connect-prompt__head">
              <h3>{p.title}</h3>
              <Button size="sm" variant="ghost" icon={Copy} onClick={() => copy(p.text, tr('promptCopied'))} aria-label={tr('copyThePromptTitle', { title: p.title })}>{tr('copy')}</Button>
            </div>
            <p className="fr-connect-prompt__text">{p.text}</p>
            {p.needs ? <p className="fr-connect-prompt__needs">{tr('needs')}{' '}{p.needs.charAt(0).toLowerCase() + p.needs.slice(1)}</p> : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

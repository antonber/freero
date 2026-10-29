// /apps — "Apps & agents" (#87): everything that connects to Freero, from the one shared catalog
// (@freero/shared integrations.ts, which the marketing site's /integrations pages use too), plus
// community listings people submitted and an operator approved. /apps/:id is an entry's connect
// step. Linked from settings, the board menu and the Connect page.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, CircleAlert, ExternalLink, Search, Send } from 'lucide-react';
import {
  INTEGRATION_CATEGORIES,
  INTEGRATION_STATUS_LABEL,
  integrationById,
  integrationDocsUrl,
  isAdminLink,
  type CommunityListing,
  type Integration,
  type IntegrationStatus,
  type WorkspaceSummary,
} from '@freero/shared';
import { Button, Input, Logo, Spinner } from '@ui';
import { api } from '../../api/client';
import { NotFoundPage } from '../NotFoundPage';
import { appLinkTargets, CATEGORY_ICON, categoryLabel, COMMUNITY_ICON, filterCatalog, filterListings, type AppsFilter } from './catalog';
import '../account/account.css';
import '../connect/connect.css';
import './apps.css';

/** The page frame every Apps & agents view shares. */
export function AppsFrame({ back, children }: { back: { to: string; label: string }; children: ReactNode }) {
  return (
    <div className="fr-acct fr-apps">
      <header className="fr-acct__top fr-apps__top">
        <Link to={back.to} className="fr-acct__back">
          <ArrowLeft size={16} aria-hidden /> {back.label}
        </Link>
        <Logo size={26} withWordmark />
      </header>
      <main className="fr-apps__main">{children}</main>
    </div>
  );
}

export function StatusChip({ status }: { status: IntegrationStatus }) {
  return <span className={`fr-apps-chip fr-apps-chip--${status}`}>{INTEGRATION_STATUS_LABEL[status]}</span>;
}

export function CommunityChip() {
  return <span className="fr-apps-chip fr-apps-chip--community">Community</span>;
}

const FILTERS: Array<{ id: AppsFilter; label: string }> = [
  { id: 'all', label: 'All' },
  ...INTEGRATION_CATEGORIES.map((c) => ({ id: c.id as AppsFilter, label: c.label })),
  { id: 'community', label: 'Community' },
];
const isFilter = (v: string | null): v is AppsFilter => FILTERS.some((f) => f.id === v);

export function AppsPage() {
  useEffect(() => {
    document.title = 'Apps & agents · Freero';
  }, []);
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const filter: AppsFilter = isFilter(params.get('category')) ? (params.get('category') as AppsFilter) : 'all';
  const [listings, setListings] = useState<CommunityListing[] | null>(null);
  const [listingsFailed, setListingsFailed] = useState(false);
  useEffect(() => {
    api.communityListings().then(
      (r) => setListings(r.listings),
      () => setListingsFailed(true),
    );
  }, []);

  const update = (next: { q?: string; category?: AppsFilter }) => {
    const p = new URLSearchParams(params);
    const q = next.q ?? query;
    const c = next.category ?? filter;
    if (q) p.set('q', q);
    else p.delete('q');
    if (c !== 'all') p.set('category', c);
    else p.delete('category');
    setParams(p, { replace: true });
  };

  const entries = useMemo(() => filterCatalog(query, filter), [query, filter]);
  const community = useMemo(() => filterListings(listings ?? [], query, filter), [listings, query, filter]);
  const grouped = !query && filter === 'all';
  // The Community filter teaches with its own empty state (how to submit); others say what does connect.
  const nothing = filter !== 'community' && entries.length === 0 && community.length === 0 && (listings !== null || listingsFailed);

  return (
    <AppsFrame back={{ to: '/app', label: 'Back to boards' }}>
      <div className="fr-apps__intro">
        <h1 className="fr-acct__title">Apps &amp; agents</h1>
        <p className="fr-apps__lead">
          Everything that works with Freero, and the one step that connects it. Any MCP client works with every board you can open, acting as you with only
          the permissions you give it.
        </p>
      </div>
      <div className="fr-apps__tools">
        <Input
          className="fr-apps__search"
          icon={Search}
          type="search"
          aria-label="Search apps and agents"
          placeholder="Search: Claude, Jira, Slack, SSO…"
          value={query}
          onChange={(e) => update({ q: e.target.value })}
        />
        <div className="fr-apps__filters" role="group" aria-label="Category">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="fr-apps__filter" aria-pressed={filter === f.id} onClick={() => update({ category: f.id })}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {nothing ? (
        <EmptyState query={query} filter={filter} onClear={() => update({ q: '', category: 'all' })} />
      ) : grouped ? (
        <>
          {INTEGRATION_CATEGORIES.map((c) => (
            <section key={c.id} className="fr-apps__group" aria-labelledby={`apps-${c.id}`}>
              <header className="fr-apps__group-head">
                <h2 id={`apps-${c.id}`}>{c.label}</h2>
                <p>{c.blurb}</p>
              </header>
              <EntryGrid entries={entries.filter((e) => e.category === c.id)} />
            </section>
          ))}
          <CommunitySection listings={community} loading={listings === null && !listingsFailed} failed={listingsFailed} />
        </>
      ) : (
        <>
          {entries.length ? <EntryGrid entries={entries} /> : null}
          {filter === 'community' || community.length ? <CommunitySection listings={community} loading={listings === null && !listingsFailed} failed={listingsFailed} /> : null}
        </>
      )}
    </AppsFrame>
  );
}

function EntryGrid({ entries }: { entries: Integration[] }) {
  return (
    <ul className="fr-apps__grid">
      {entries.map((e) => {
        const Icon = CATEGORY_ICON[e.category];
        return (
          <li key={e.id}>
            <Link className="fr-apps-card" to={`/apps/${e.id}`} data-testid="apps-card">
              <span className="fr-apps-card__icon" aria-hidden>
                <Icon size={18} />
              </span>
              <span className="fr-apps-card__body">
                <span className="fr-apps-card__name">{e.name}</span>
                <span className="fr-apps-card__line">{e.oneLiner}</span>
                <span className="fr-apps-card__meta">
                  <StatusChip status={e.status} />
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function CommunitySection({ listings, loading, failed }: { listings: CommunityListing[]; loading: boolean; failed: boolean }) {
  return (
    <section className="fr-apps__group" aria-labelledby="apps-community">
      <header className="fr-apps__group-head fr-apps__group-head--row">
        <div>
          <h2 id="apps-community">Community</h2>
          <p>Integrations people built on Freero’s MCP server and API, listed after a review. Freero doesn’t run them: each signs in with the permissions you grant it.</p>
        </div>
        <Link className="fr-apps-btnlink" to="/apps/submit">
          <Send size={15} aria-hidden /> Submit yours
        </Link>
      </header>
      {loading ? (
        <Spinner size={20} label="Loading community listings" />
      ) : failed ? (
        <p className="fr-acct__error">Could not load the community listings. Reload the page to try again.</p>
      ) : listings.length ? (
        <ul className="fr-apps__grid">
          {listings.map((l) => (
            <li key={l.id}>
              <Link className="fr-apps-card" to={`/apps/community/${encodeURIComponent(l.id)}`} data-testid="community-card">
                <span className="fr-apps-card__icon fr-apps-card__icon--community" aria-hidden>
                  <COMMUNITY_ICON size={18} />
                </span>
                <span className="fr-apps-card__body">
                  <span className="fr-apps-card__name">{l.name}</span>
                  <span className="fr-apps-card__line">{l.tagline}</span>
                  <span className="fr-apps-card__meta">
                    <CommunityChip />
                    {l.featured ? <span className="fr-apps-chip fr-apps-chip--featured">Featured</span> : null}
                    <span className="fr-apps-card__cat">{categoryLabel(l.category)}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="fr-apps-empty fr-apps-empty--inline">
          <p className="fr-apps-empty__title">No community listings yet</p>
          <p>
            Built a bot, a sync or an agent on Freero’s MCP server, REST API or webhooks? Submit it: once a reviewer approves it, everyone on this Freero finds it
            here.
          </p>
        </div>
      )}
    </section>
  );
}

/** Nothing matched: say what does connect, so a search never ends in a dead end. */
function EmptyState({ query, filter, onClear }: { query: string; filter: AppsFilter; onClear: () => void }) {
  return (
    <div className="fr-apps-empty" role="status">
      <p className="fr-apps-empty__title">{query ? `Nothing called “${query}” here yet` : 'Nothing here yet'}</p>
      <p>
        Freero works with any MCP client, so an assistant or coding agent that isn’t listed usually connects the same way, with your server’s MCP address. A
        tool with webhooks or an API can use Freero’s REST API and webhooks.
      </p>
      <ul className="fr-apps-empty__links">
        <li>
          <Link to="/apps/mcp-client">Connect any MCP client</Link>
        </li>
        <li>
          <Link to="/apps/rest-api">Use the REST API</Link>
        </li>
        <li>
          <Link to="/apps/submit">Built an integration? Submit it</Link>
        </li>
      </ul>
      {query || filter !== 'all' ? (
        <Button size="sm" variant="ghost" onClick={onClear}>
          Show everything
        </Button>
      ) : null}
    </div>
  );
}

/** /apps/:id — one catalog entry and its connect step. */
export function IntegrationPage() {
  const { id = '' } = useParams();
  const entry = integrationById(id);
  useEffect(() => {
    if (entry) document.title = `${entry.name} · Apps & agents · Freero`;
  }, [entry]);
  if (!entry) return <NotFoundPage />;
  return <IntegrationDetail entry={entry} />;
}

function IntegrationDetail({ entry }: { entry: Integration }) {
  const Icon = CATEGORY_ICON[entry.category];
  const admin = entry.connect.app && isAdminLink(entry.connect.app);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(admin ? null : []);
  useEffect(() => {
    if (!admin) return;
    api.listWorkspaces().then(
      (r) => setWorkspaces(r.workspaces),
      () => setWorkspaces([]),
    );
  }, [admin]);
  const targets = entry.connect.app && workspaces ? appLinkTargets(entry.connect.app, workspaces) : [];
  const navigate = useNavigate();
  const related = filterCatalog('', entry.category).filter((e) => e.id !== entry.id).slice(0, 6);

  return (
    <AppsFrame back={{ to: '/apps', label: 'Apps & agents' }}>
      <article className="fr-apps-detail">
        <header className="fr-apps-detail__head">
          <span className="fr-apps-detail__icon" aria-hidden>
            <Icon size={22} />
          </span>
          <div className="fr-apps-detail__title">
            <p className="fr-apps-detail__kicker">{categoryLabel(entry.category)}</p>
            <h1 className="fr-acct__title">{entry.name}</h1>
            <p className="fr-apps-detail__line">{entry.oneLiner}</p>
            <StatusChip status={entry.status} />
          </div>
        </header>
        <section className="fr-acct-card" aria-labelledby="connect-title" id="connect">
          <header className="fr-acct-card__head">
            <h2 id="connect-title">How to connect</h2>
          </header>
          <ol className="fr-connect-steps">
            {entry.connect.steps.map((s, i) => (
              <li key={i} className="fr-connect-step">
                <p className="fr-connect-step__text">{s}</p>
              </li>
            ))}
          </ol>
          {entry.operatorSetup ? (
            <p className="fr-apps-note" role="note">
              <CircleAlert size={15} aria-hidden /> {entry.operatorSetup}
            </p>
          ) : null}
          <div className="fr-apps-detail__actions">
            {entry.connect.app && workspaces === null ? <Spinner size={18} label="Loading your teams" /> : null}
            {targets.map((t, i) => (
              <Button key={t.to} variant={i === 0 ? 'primary' : 'secondary'} icon={ArrowRight} onClick={() => navigate(t.to)} data-testid="connect-action">
                {t.label}
              </Button>
            ))}
            {admin && workspaces && !targets.length ? (
              <p className="fr-apps-note" data-testid="ask-admin">
                This is set up by a team’s owner or admin in its admin console. You don’t administer a team here, so ask one of your team’s admins, or create a
                team from your boards page.
              </p>
            ) : null}
            {entry.connect.docs ? (
              <a className="fr-apps-btnlink" href={integrationDocsUrl(entry.connect.docs)} target="_blank" rel="noopener noreferrer">
                <BookOpen size={15} aria-hidden /> {entry.connect.docs.label} <ExternalLink size={13} aria-hidden />
              </a>
            ) : null}
          </div>
        </section>
        <section className="fr-acct-card" aria-labelledby="about-title">
          <header className="fr-acct-card__head">
            <h2 id="about-title">What it does</h2>
          </header>
          {entry.description.map((p, i) => (
            <p key={i} className="fr-acct__p">
              {p}
            </p>
          ))}
        </section>
        {related.length ? (
          <nav className="fr-apps-related" aria-label={`More ${categoryLabel(entry.category)}`}>
            <h2>More in {categoryLabel(entry.category)}</h2>
            <ul>
              {related.map((r) => (
                <li key={r.id}>
                  <Link to={`/apps/${r.id}`}>{r.name}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </article>
    </AppsFrame>
  );
}

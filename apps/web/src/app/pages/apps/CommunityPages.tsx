// Community listings on the Apps & agents page (#87): one listing (/apps/community/:id), with the
// existing Report flow (the same reasons and queue as board reports), and the submit page
// (/apps/submit) with the person's own submissions and their review status.
//
// Everything in a listing was typed by its developer: it is rendered as text only (React escapes
// it; no markup, no Markdown), and its links — https only, checked by the server — open in a new
// tab without the referrer or this page as `opener`, marked nofollow ugc.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BookOpen, ExternalLink, Flag, Globe, Send, ShieldAlert, Trash2 } from 'lucide-react';
import {
  INTEGRATION_CATEGORIES,
  LISTING_LIMITS,
  LISTING_SURFACES,
  MAX_REPORT_NOTE,
  REPORT_REASONS,
  type CommunityListing,
  type IntegrationCategory,
  type ListingSurface,
  type OAuthClientInfo,
  type OwnListing,
  type ReportReason,
} from '@freero/shared';
import { Button, Input, Modal, Select, Spinner, TextArea, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { relativeTime } from '../../lib/time';
import { NotFoundPage } from '../NotFoundPage';
import { AppsFrame, CommunityChip } from './AppsPage';
import { categoryLabel, COMMUNITY_ICON } from './catalog';

import { t } from './messages';
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError && err.status < 500 ? err.message : fallback);
const isOwn = (l: CommunityListing | OwnListing): l is OwnListing => 'status' in l;
/** Developers' links: never this page as opener, no referrer, and no ranking credit from us. */
const UNTRUSTED_REL = 'noopener noreferrer nofollow ugc';

const STATUS_TEXT: Record<OwnListing['status'], { label: string; tone: string; say: string }> = {
  pending: { label: t('waitingForReview'), tone: 'pending', say: t('onlyYouAndFreeroS') },
  approved: { label: t('live'), tone: 'live', say: t('everyoneSignedInToThis') },
  rejected: { label: t('notApproved'), tone: 'off', say: t('nobodyElseSeesItWithdraw') },
  removed: { label: t('removed'), tone: 'off', say: t('freeroSModeratorsRemovedIt') },
};

function ListingStatus({ listing }: { listing: OwnListing }) {
  const s = STATUS_TEXT[listing.status];
  return (
    <div className={`fr-apps-status fr-apps-status--${s.tone}`} role="status" data-testid="listing-status">
      <strong>{s.label}</strong> <span>{s.say}</span>
      {listing.statusNote ? <p className="fr-apps-status__note">{t('reviewerStatusnote', { statusNote: listing.statusNote })}</p> : null}
    </div>
  );
}

/** /apps/community/:id */
export function CommunityListingPage() {
  const { id = '' } = useParams();
  const [listing, setListing] = useState<CommunityListing | OwnListing | null | undefined>(undefined);
  const [reporting, setReporting] = useState(false);
  useEffect(() => {
    api.communityListing(id).then(
      (r) => setListing(r.listing),
      () => setListing(null),
    );
  }, [id]);
  useEffect(() => {
    if (listing) document.title = `${listing.name} · Apps & agents · Freero`;
  }, [listing]);
  if (listing === undefined) return <AppsFrame back={{ to: '/apps', label: t('appsAgents') }}><Spinner size={22} label={t('loading')} /></AppsFrame>;
  if (listing === null) return <NotFoundPage />;
  const own = isOwn(listing);
  const live = !own || listing.status === 'approved';

  return (
    <AppsFrame back={{ to: own ? '/apps/submit' : '/apps?category=community', label: own ? t('yourListings') : t('communityListings') }}>
      <article className="fr-apps-detail">
        <header className="fr-apps-detail__head">
          <span className="fr-apps-detail__icon fr-apps-detail__icon--community" aria-hidden>
            <COMMUNITY_ICON size={22} />
          </span>
          <div className="fr-apps-detail__title">
            <p className="fr-apps-detail__kicker">{categoryLabel(listing.category)}</p>
            <h1 className="fr-acct__title">{listing.name}</h1>
            <p className="fr-apps-detail__line">{listing.tagline}</p>
            <span className="fr-apps-card__meta">
              <CommunityChip />
              {listing.featured ? <span className="fr-apps-chip fr-apps-chip--featured">{t('featured')}</span> : null}
            </span>
          </div>
        </header>
        {own ? <ListingStatus listing={listing} /> : null}
        <section className="fr-acct-card" aria-labelledby="listing-connect">
          <header className="fr-acct-card__head">
            <h2 id="listing-connect">{t('howToConnect')}</h2>
            <p>{t('itsDeveloperBuiltItOn', { builtOnText: builtOnText(listing.builtOn) })}</p>
          </header>
          <div className="fr-apps-detail__actions">
            <a className="fr-connect-install" href={listing.website} target="_blank" rel={UNTRUSTED_REL} data-testid="listing-website">
              <Globe size={16} aria-hidden /> {hostOf(listing.website)} <ExternalLink size={13} aria-hidden />
            </a>
            {listing.docsUrl ? (
              <a className="fr-apps-btnlink" href={listing.docsUrl} target="_blank" rel={UNTRUSTED_REL}>
                <BookOpen size={15} aria-hidden />{' '}{t('theirDocs')}{' '}<ExternalLink size={13} aria-hidden />
              </a>
            ) : null}
          </div>
          <p className="fr-apps-note" role="note">
            <ShieldAlert size={15} aria-hidden />
            {listing.oauthApp
              ? t('itSignsInWithIts', { name: listing.oauthApp.name })
              : t('freeroReviewedThisListingNot')}
          </p>
        </section>
        {listing.description ? (
          <section className="fr-acct-card" aria-labelledby="listing-about">
            <header className="fr-acct-card__head">
              <h2 id="listing-about">{t('fromTheDeveloper')}</h2>
            </header>
            <p className="fr-apps-untrusted">{listing.description}</p>
          </section>
        ) : null}
        {live && !own ? (
          <div className="fr-apps-detail__foot">
            <Button size="sm" variant="ghost" icon={Flag} onClick={() => setReporting(true)}>{t('reportThisListing')}</Button>
          </div>
        ) : null}
      </article>
      {reporting ? <ReportListingDialog listing={listing} onClose={() => setReporting(false)} /> : null}
    </AppsFrame>
  );
}

const SURFACE_PHRASE: Record<ListingSurface, string> = { mcp: t('freeroSMcpServer'), api: 'the REST API', webhooks: 'webhooks' };
/** "Freero’s MCP server and webhooks". */
const builtOnText = (on: ListingSurface[]) => {
  const parts = on.map((s) => SURFACE_PHRASE[s] ?? s);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? 'Freero');
};

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** The existing Report flow for a listing: the same reasons, the same moderation queue. */
function ReportListingDialog({ listing, onClose }: { listing: CommunityListing; onClose: () => void }) {
  const notify = useToast();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.reportListing({ target: { kind: 'listing', id: listing.id }, reason, note: note.trim() });
      notify(t('thanksForYourReportFreero'), 'success');
      onClose();
    } catch (e) {
      setError(errorText(e, t('yourReportCouldNotBe')));
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('reportThisListing')}
      description={t('tellFreeroSModeratorsWhat')}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
          <Button variant="primary" onClick={send} disabled={!reason} loading={busy}>{t('sendReport')}</Button>
        </>
      }
    >
      <fieldset className="fr-apps-reasons">
        <legend className="fr-apps-form__label">{t('whatSTheProblem')}</legend>
        {REPORT_REASONS.map((r) => (
          <label key={r.id} className="fr-apps-reason">
            <input type="radio" name="fr-apps-report-reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} />
            <span>{r.label}</span>
          </label>
        ))}
      </fieldset>
      <TextArea label={t('detailsOptional')} value={note} maxLength={MAX_REPORT_NOTE} rows={3} onChange={(e) => setNote(e.target.value)} />
      {error ? (
        <p className="fr-acct__error" role="alert">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

const CATEGORY_OPTIONS = INTEGRATION_CATEGORIES.map((c) => ({ value: c.id, label: c.label }));
const NO_APP = '';

/** /apps/submit — submit an integration, and the person's own listings with their status. */
export function SubmitListingPage() {
  useEffect(() => {
    document.title = 'Submit an integration · Freero';
  }, []);
  const { user } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();
  const [mine, setMine] = useState<OwnListing[] | null>(null);
  const [apps, setApps] = useState<OAuthClientInfo[]>([]);
  const load = () => api.myListings().then((r) => setMine(r.listings), () => setMine([]));
  useEffect(() => {
    void load();
    api.listOAuthClients().then((r) => setApps(r.clients), () => setApps([]));
  }, []);

  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('https://');
  const [docsUrl, setDocsUrl] = useState('');
  const [category, setCategory] = useState<IntegrationCategory>('agents');
  const [builtOn, setBuiltOn] = useState<ListingSurface[]>(['mcp']);
  const [oauthClientId, setOauthClientId] = useState(NO_APP);
  const [contactEmail, setContactEmail] = useState(user?.email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^https:\/\/[^/\s]+\.[^/\s]/.test(website.trim())) return setError(t('theWebsiteMustBeAn'));
    if (docsUrl.trim() && !/^https:\/\//.test(docsUrl.trim())) return setError(t('theDocsLinkMustBe'));
    if (!builtOn.length) return setError(t('tickWhatItIsBuilt'));
    setBusy(true);
    setError(null);
    try {
      const { listing } = await api.submitListing({
        name: name.trim(),
        tagline: tagline.trim(),
        description: description.trim(),
        website: website.trim(),
        docsUrl: docsUrl.trim() || null,
        category,
        builtOn,
        oauthClientId: oauthClientId || null,
        contactEmail: contactEmail.trim() || null,
      });
      notify(t('submittedAReviewerWillLook'), 'success');
      navigate(`/apps/community/${encodeURIComponent(listing.id)}`);
    } catch (err) {
      setError(errorText(err, t('couldNotSubmitItTry')));
      setBusy(false);
    }
  };

  const withdraw = async (l: OwnListing) => {
    try {
      await api.withdrawListing(l.id);
      notify(t('withdrewName', { name: l.name }), 'info');
      void load();
    } catch (err) {
      notify(errorText(err, t('couldNotWithdrawIt')), 'error');
    }
  };

  return (
    <AppsFrame back={{ to: '/apps?category=community', label: t('appsAgents') }}>
      <div className="fr-apps__intro">
        <h1 className="fr-acct__title">{t('submitAnIntegration')}</h1>
        <p className="fr-apps__lead">{t('builtSomethingOnFreeroS')}</p>
      </div>
      <YourListings listings={mine} onWithdraw={withdraw} />
      <form className="fr-acct-card fr-apps-form" onSubmit={submit} noValidate aria-labelledby="submit-title">
        <header className="fr-acct-card__head">
          <h2 id="submit-title">{t('yourIntegration')}</h2>
          <p>{t('writeItAsPlainText')}</p>
        </header>
        <Input label={t('name')} required maxLength={LISTING_LIMITS.name} value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          label={t('oneLineAboutIt')}
          hint={t('whatItDoesForSomeone')}
          required
          maxLength={LISTING_LIMITS.tagline}
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
        />
        <TextArea label={t('description')} rows={5} maxLength={LISTING_LIMITS.description} value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="fr-apps-form__grid">
          <Input label={t('websiteHttps')} type="url" required maxLength={LISTING_LIMITS.url} value={website} onChange={(e) => setWebsite(e.target.value)} />
          <Input label={t('docsHttpsOptional')} type="url" maxLength={LISTING_LIMITS.url} value={docsUrl} onChange={(e) => setDocsUrl(e.target.value)} />
        </div>
        <div className="fr-apps-form__grid">
          <div className="fr-apps-form__field">
            <span className="fr-apps-form__label" id="submit-category">{t('category')}</span>
            <Select<IntegrationCategory> aria-label={t('category')} options={CATEGORY_OPTIONS} value={category} onChange={setCategory} />
          </div>
          <div className="fr-apps-form__field">
            <span className="fr-apps-form__label">{t('itsOauthAppOptional')}</span>
            <Select<string>
              aria-label={t('itsOauthApp')}
              options={[{ value: NO_APP, label: apps.length ? t('none') : t('noneRegistered') }, ...apps.map((a) => ({ value: a.clientId, label: a.name }))]}
              value={oauthClientId}
              onChange={setOauthClientId}
            />
          </div>
        </div>
        <fieldset className="fr-apps-form__surfaces">
          <legend className="fr-apps-form__label">{t('builtOn')}</legend>
          {LISTING_SURFACES.map((s) => (
            <label key={s.id} className="fr-apps-reason">
              <input type="checkbox" checked={builtOn.includes(s.id)} onChange={(e) => setBuiltOn((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((x) => x !== s.id)))} />
              <span>{s.label}</span>
            </label>
          ))}
        </fieldset>
        <Input
          label={t('contactEmailForReviewers')}
          hint={t('onlyFreeroSReviewersSee')}
          type="email"
          maxLength={LISTING_LIMITS.email}
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
        />
        {error ? (
          <p className="fr-acct__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="fr-acct-form__row">
          <Button type="submit" variant="primary" icon={Send} loading={busy}>{t('submitForReview')}</Button>
        </div>
      </form>
    </AppsFrame>
  );
}

function YourListings({ listings, onWithdraw }: { listings: OwnListing[] | null; onWithdraw: (l: OwnListing) => void }) {
  if (listings === null) return <Spinner size={20} label={t('loadingYourListings')} />;
  if (!listings.length) return null;
  return (
    <section className="fr-acct-card" aria-labelledby="mine-title">
      <header className="fr-acct-card__head">
        <h2 id="mine-title">{t('yourListings')}</h2>
      </header>
      <ul className="fr-apps-mine">
        {listings.map((l) => (
          <li key={l.id} className="fr-apps-mine__row" data-testid="own-listing">
            <span className="fr-apps-mine__who">
              <Link to={`/apps/community/${encodeURIComponent(l.id)}`} className="fr-apps-mine__name">
                {l.name}
              </Link>
              <span className={`fr-apps-mine__status fr-apps-status--${STATUS_TEXT[l.status].tone}`}>{STATUS_TEXT[l.status].label}</span>
              <span className="fr-apps-mine__meta">{t('submittedValue', { value: relativeTime(l.createdAt) })}</span>
            </span>
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => onWithdraw(l)} aria-label={t('withdrawName', { name: l.name })}>{t('withdraw')}</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

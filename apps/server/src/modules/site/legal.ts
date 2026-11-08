// The legal pages (/privacy, /terms, /acceptable-use) and /support are built once, like every page,
// with tokens where a deployment's own facts go: who operates it, how to reach them, the law that
// governs the terms, and the retention periods this server is configured with. They are filled in
// here when the page is served, the same way PUBLIC_URL is.
//
// The guard: the build renders legal pages as drafts (a visible "Draft: not in effect" banner and
// `noindex`). Only once SITE_LEGAL_OPERATOR is set does this module remove the banner and let
// search engines index them. A server that never sets it can't present a draft as terms in force.
import { DEFAULT_AUDIT_RETENTION_DAYS, TRASH_RETENTION_DAYS } from '@freero/shared';
import type { Config } from '../../platform/config';

/** Keep in step with apps/site/src/lib/legal.ts (`legal()` tokens, the banner and the robots meta). */
const TOKEN = /\[\[freero-legal:([a-zA-Z]+)\]\]/g;
const BANNER = /<aside class="legal-draft"[^>]*>[\s\S]*?<\/aside>/g;
const DRAFT_ROBOTS = '<meta name="robots" content="noindex, follow"/>';
const INDEX_ROBOTS = '<meta name="robots" content="index, follow, max-image-preview:large"/>';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const unset = (what: string) => `<span class="legal-unset">[${escapeHtml(what)}: not set yet]</span>`;
const mailLink = (email: string) => `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`;
/** A mailto: or https: contact (SECURITY_CONTACT) as a link. */
const contactLink = (contact: string) =>
  contact.startsWith('mailto:') ? mailLink(contact.slice('mailto:'.length)) : `<a href="${escapeHtml(contact)}">${escapeHtml(contact)}</a>`;
const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
};
const code = (s: string) => `<code>${escapeHtml(s)}</code>`;
const days = (ms: number) => String(Math.round(ms / 86_400_000));
const hoursOrDays = (ms: number) => {
  const h = Math.round(ms / 3_600_000);
  return h % 24 === 0 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${h} hour${h === 1 ? '' : 's'}`;
};

export interface LegalFill {
  /** The terms are in force: the operator is named. */
  inEffect: boolean;
  /** HTML for each token key. */
  values: Record<string, string>;
}

/** What each token becomes on this server (HTML, escaped). */
export function legalFill(config: Config): LegalFill {
  const l = config.site.legal;
  const contact = l.contactEmail ?? config.abuseContactEmail;
  const abuse = config.abuseContactEmail ?? l.contactEmail;
  return {
    inEffect: l.operator !== null,
    values: {
      operator: l.operator ? escapeHtml(l.operator) : unset('the operator’s legal name'),
      // ", <address>" after the operator's name. A draft shows the gap; terms in force without an
      // address leave the clause out rather than print a placeholder.
      atAddress: l.address ? `, ${escapeHtml(l.address)}` : l.operator ? '' : `, ${unset('postal address')}`,
      // The address on its own line (the DPA's list of parties): a gap there always shows.
      postalAddress: l.address ? escapeHtml(l.address) : unset('postal address'),
      jurisdiction: l.jurisdiction ? escapeHtml(l.jurisdiction) : unset('governing law'),
      contact: contact ? mailLink(contact) : unset('contact email'),
      abuseContact: abuse ? mailLink(abuse) : unset('abuse contact email'),
      securityContact: config.securityContact ? contactLink(config.securityContact) : contact ? mailLink(contact) : unset('security contact'),
      deletionGraceDays: days(config.accountDeletionGraceMs),
      exportExpiry: hoursOrDays(config.dataExportTtlMs),
      eventsRetentionDays: String(config.events.retentionDays),
      moderationKeepDays: days(config.moderationKeepRemovedMs),
      problemRetentionDays: days(config.problemRetentionMs),
      trashDays: String(TRASH_RETENTION_DAYS),
      auditRetentionDays: String(DEFAULT_AUDIT_RETENTION_DAYS),
      backupRetentionDays: l.backupDays !== null ? String(l.backupDays) : unset('backup retention in days'),
      logRetentionDays: l.logDays !== null ? String(l.logDays) : unset('log retention in days'),
      // Processors, as this server is configured right now (never a list someone has to keep in step).
      hosting: l.hosting ? escapeHtml(l.hosting) : unset('hosting provider and region'),
      // The operator's name for the provider (SITE_LEGAL_MAIL / SITE_LEGAL_STORAGE) with the host the
      // server really talks to, so a changed SMTP_URL or bucket shows even before the name is updated.
      mailProvider: config.smtpUrl
        ? `${l.mail ? `${escapeHtml(l.mail)}, ` : ''}the email delivery service at ${code(hostOf(config.smtpUrl) ?? 'SMTP')}`
        : 'no email delivery service (this server sends no email)',
      storageProvider: config.s3
        ? `${l.storage ? `${escapeHtml(l.storage)}, ` : ''}S3-compatible object storage at ${code(config.s3.endpoint ? (hostOf(config.s3.endpoint) ?? 'S3') : `Amazon S3 (${config.s3.region})`)}`
        : 'the server’s own disk',
      aiProvider: config.ai.instance
        ? `the AI model provider at ${code(hostOf(config.ai.instance.baseUrl) ?? config.ai.instance.provider)} (model ${code(config.ai.instance.model)})`
        : 'no AI model provider for the whole service: AI features are off',
      aiWorkspaces: config.ai.workspaceKeys
        ? 'The admins of a team workspace may also connect their own AI provider for that workspace; its boards’ AI requests then go to that provider instead, under the workspace’s own agreement with it.'
        : 'Team workspaces cannot connect providers of their own on this service.',
      errorReporting: config.errorReportingDsn
        ? `When the server hits an unexpected error, a report goes to the error-tracking service at ${code(hostOf(config.errorReportingDsn) ?? 'error tracking')}: the error, the request’s method and path (never its body or query string) and your account id.`
        : 'No error-tracking service is used: errors stay in the server’s own logs.',
      ...analyticsText(config),
      status: l.statusUrl ? `<a href="${escapeHtml(l.statusUrl)}">${escapeHtml(l.statusUrl)}</a>` : 'there is no separate status page yet: write to the contact address below',
    },
  };
}

type AnalyticsToken =
  | 'analytics'
  | 'analyticsCookies'
  | 'analyticsProvider'
  | 'analyticsData'
  | 'analyticsPurpose'
  | 'analyticsBasis'
  | 'productAnalytics'
  | 'productAnalyticsProvider'
  | 'productAnalyticsData'
  | 'productAnalyticsWhere';

/** Where PostHog keeps the events, from the host the server sends them to (POSTHOG_HOST). */
function posthogWhere(host: string): string {
  const name = hostOf(host) ?? host;
  if (/(^|\.)us\.(i\.)?posthog\.com$/.test(name)) return 'the United States';
  if (/(^|\.)eu\.(i\.)?posthog\.com$/.test(name)) return 'the European Union (Germany)';
  return `wherever the service at ${code(name)} runs`;
}

/**
 * What the privacy policy says about analytics: Google Analytics (GA_MEASUREMENT_ID), PostHog
 * product events (POSTHOG_KEY; modules/analytics productEvents.ts and @freero/shared
 * `productEventProperties` are what it describes) and an operator's own marketing-page script
 * (SITE_ANALYTICS_SRC), as configured.
 */
function analyticsText(config: Config): Record<AnalyticsToken, string> {
  const ga = config.googleAnalyticsId;
  const ph = config.posthog;
  const site = config.site.analytics
    ? `These marketing pages also load an analytics script from ${code(new URL(config.site.analytics.src).origin)}, which counts page visits under its own privacy terms.`
    : '';
  const cookieName = ga ? `_ga_${ga.replace(/^G-/, '')}` : '';
  const where = ph ? posthogWhere(ph.host) : '';
  return {
    analytics:
      ga && ph
        ? `We use Google Analytics to count visits and a few actions, and PostHog to see how the app is used after sign-up, under a pseudonym; you can turn both off (see <a href="#cookies">Cookies</a>). ${site}`.trim()
        : ga
          ? `We use Google Analytics to count visits and a few actions; you can turn it off (see <a href="#cookies">Cookies</a>). ${site}`.trim()
          : ph
            ? `Our server tells PostHog about a few actions in the app, under a pseudonym, to see how it is used after sign-up; you can turn it off (see <a href="#cookies">Cookies</a>). ${site}`.trim()
            : site || 'These pages load no analytics script, and the app has none.',
    // Paragraphs and a list (the page puts this token in a <div>).
    analyticsCookies: ga
      ? [
          `<p>The cookies below are needed for the service to work; none are for advertising. We also use Google Analytics, provided by Google LLC as our processor, to see how our pages and the app are used. It is on by default:</p><ul>`,
          `<li>It sets the cookies ${code('_ga')} and ${code(cookieName)} (kept up to 13 months) to count visits.</li>`,
          `<li>It receives the kind of page you are on (boards, docs and invitations only as a generic address such as ${code('/board')}), the referring site’s domain, your browser, device and screen size, an approximate location Google derives from your IP address, and these events: signing up or logging in (with the method, such as password, and, when you sign up, how you found Freero if you answered), creating a board, and using one of Freero’s public templates.</li>`,
          `<li>It never receives what is on your boards or docs, their titles, what you search for, or your name, email address or account id. It never runs on boards embedded in an assistant, on other sites or in Microsoft Teams, in the operators’ console or on the screen where you connect an app.</li>`,
          `<li>Advertising features (Google signals, ad personalisation and ad data) are always off.</li>`,
          `<li>Google may process this data in the United States; see <a href="https://policies.google.com/technologies/partner-sites">how Google uses information from sites that use its services</a>.</li></ul>`,
          `<p>We rely on our legitimate interest in understanding and improving the service. You can opt out at any time with <a href="#cookies" data-freero-analytics-toggle>Turn off analytics</a> (also at the bottom of our pages and in the app’s Help menu): measuring stops in that browser, its analytics cookies are deleted, and the choice is remembered there. If your browser sends Global Privacy Control or Do Not Track, analytics stays off.</p>`,
        ].join('')
      : '<p>The app uses only cookies it needs to work. None are for advertising or analytics. The marketing pages set no cookies.</p>',
    analyticsProvider: ga
      ? 'Google Analytics (Google LLC); you can turn it off'
      : config.site.analytics
        ? `The analytics service at ${code(new URL(config.site.analytics.src).origin)} (marketing pages only)`
        : ph
          ? 'None for page visits (product analytics: see the next row)'
          : 'None: this service uses no analytics',
    analyticsData: ga
      ? 'The kind of page you visit (no board or doc ids or titles), the referring domain, browser and device details, an approximate location from your IP address, and the events listed under Cookies'
      : config.site.analytics
        ? 'Page visits on the marketing pages'
        : '—',
    analyticsPurpose:
      [
        ga ? 'Counting visits to our pages and the app, and a few actions such as sign-ups, with Google Analytics' : config.site.analytics ? 'Counting visits to the marketing pages' : '',
        ph ? 'Seeing how the app is used after sign-up (for example whether new accounts create a board, invite someone or come back) with PostHog, under a pseudonym' : '',
      ]
        .filter(Boolean)
        .map((s, i) => (i > 0 ? s[0].toLowerCase() + s.slice(1) : s))
        .join('; ')
        .concat(ga || ph ? ' (you can opt out)' : '') || 'Not done on this service',
    analyticsBasis: ga || ph ? 'Legitimate interests (understanding and improving the service); you can object by opting out' : '—',
    // Paragraphs and a list (the page puts this token in a <div>), like analyticsCookies.
    productAnalytics: ph
      ? [
          `<p>We also use PostHog, provided by PostHog, Inc. as our processor, to see how the app is used after sign-up: for example, whether new accounts create a board, invite someone or come back. It is on by default${ga ? ' and works differently from Google Analytics' : ''}:</p><ul>`,
          `<li>Our server sends the events. No PostHog script runs in your browser, and PostHog sets no cookies.</li>`,
          `<li>PostHog knows you only by a keyed hash of your account id, not the id itself, and a workspace only by the same kind of hash of its id.</li>`,
          `<li>It receives these events, each with its time: signing up (the method, such as password, Google or your organization’s single sign-on, and how you found Freero if you answered); logging in (the method); creating a board or doc (whether in the app, through the API, through a connected assistant or from a backup file, and whether it is a copy); someone else opening one of your boards for the first time; sending or accepting an invitation to a board or workspace (the role, and whether the person invited already had an account); creating a team workspace; connecting an app or assistant (how it was registered and whether it uses MCP or the API, never which app); connecting an issue tracker (which one), Slack or Figma; exporting a board (the format); turning on a board’s link (the access it gives); and using one of Freero’s public templates (its id).</li>`,
          `<li>It never receives your name, email address or account id, the titles or content of your boards, docs or workspaces, links, your IP address (the events come from our server, and PostHog’s location lookup is off) or details of your browser or device.</li>`,
          `<li>PostHog processes this data in ${where}.</li></ul>`,
          `<p>${ga ? '<strong>Turn off analytics</strong> stops this too' : '<strong>Turn off analytics</strong> in the app’s Help menu stops it'}: if you are signed in, the choice is recorded on your account, so nothing is sent for your account from any browser, app or assistant until you turn analytics back on. If your browser sends Global Privacy Control or Do Not Track, nothing is sent for what you do in it, and the choice is recorded on your account when you sign in there.</p>`,
        ].join('')
      : '',
    productAnalyticsProvider: ph ? `PostHog, Inc. (events sent by our server to ${code(hostOf(ph.host) ?? ph.host)}); you can turn it off` : 'None: this service sends no product analytics',
    productAnalyticsData: ph
      ? 'A keyed hash of the account id (and of a workspace’s id) and the events listed under Cookies, with their method, format or role; never names, email addresses, titles, content, links or IP addresses'
      : '—',
    productAnalyticsWhere: ph ? where : 'Not used',
  };
}

/**
 * A page with its tokens filled; a legal page also loses its draft banner and noindex once in
 * effect, except that a page still under review (not approved by the operator) stays noindex.
 */
export function withLegal(html: string, fill: LegalFill, legalPage: boolean, underReview = false): string {
  let out = html.includes('[[freero-legal:') ? html.replace(TOKEN, (m, key: string) => fill.values[key] ?? m) : html;
  if (legalPage && fill.inEffect) {
    out = out.replace(BANNER, '');
    if (!underReview) out = out.replace(DRAFT_ROBOTS, INDEX_ROBOTS);
  }
  return out;
}

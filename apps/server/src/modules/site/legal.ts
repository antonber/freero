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

/**
 * What the privacy policy says about analytics: Google Analytics (GA_MEASUREMENT_ID, only with
 * consent) and an operator's own marketing-page script (SITE_ANALYTICS_SRC), as configured.
 */
function analyticsText(config: Config): Record<'analytics' | 'analyticsCookies' | 'analyticsProvider' | 'analyticsData' | 'analyticsPurpose' | 'analyticsBasis', string> {
  const ga = config.googleAnalyticsId;
  const site = config.site.analytics
    ? `These marketing pages also load an analytics script from ${code(new URL(config.site.analytics.src).origin)}, which counts page visits under its own privacy terms.`
    : '';
  const cookieName = ga ? `_ga_${ga.replace(/^G-/, '')}` : '';
  return {
    analytics: ga
      ? `We use Google Analytics to count visits and a few actions; you can turn it off (see <a href="#cookies">Cookies</a>). ${site}`.trim()
      : site || 'These pages load no analytics script, and the app has none.',
    // Paragraphs and a list (the page puts this token in a <div>).
    analyticsCookies: ga
      ? [
          `<p>The cookies below are needed for the service to work; none are for advertising. We also use Google Analytics, provided by Google LLC as our processor, to see how our pages and the app are used. It is on by default:</p><ul>`,
          `<li>It sets the cookies ${code('_ga')} and ${code(cookieName)} (kept up to 13 months) to count visits.</li>`,
          `<li>It receives the kind of page you are on (boards, docs and invitations only as a generic address such as ${code('/board')}), the referring site’s domain, your browser, device and screen size, an approximate location Google derives from your IP address, and these events: signing up or logging in (with the method, such as password), creating a board, and using one of Freero’s public templates.</li>`,
          `<li>It never receives what is on your boards or docs, their titles, what you search for, or your name, email address or account id. It never runs on boards embedded in an assistant, on other sites or in Microsoft Teams, in the operators’ console or on the screen where you connect an app.</li>`,
          `<li>Advertising features (Google signals, ad personalisation and ad data) are always off.</li>`,
          `<li>Google may process this data in the United States; see <a href="https://policies.google.com/technologies/partner-sites">how Google uses information from sites that use its services</a>.</li></ul>`,
          `<p>We rely on our legitimate interest in understanding and improving the service. You can opt out at any time with <a href="#cookies" data-freero-analytics-toggle>Turn off analytics</a> (also at the bottom of our pages and in the app’s Help menu): measuring stops in that browser, its analytics cookies are deleted, and the choice is remembered there. If your browser sends Global Privacy Control or Do Not Track, analytics stays off.</p>`,
        ].join('')
      : '<p>The app uses only cookies it needs to work. None are for advertising or analytics. The marketing pages set no cookies.</p>',
    analyticsProvider: ga ? 'Google Analytics (Google LLC); you can turn it off' : config.site.analytics ? `The analytics service at ${code(new URL(config.site.analytics.src).origin)} (marketing pages only)` : 'None: this service uses no analytics',
    analyticsData: ga
      ? 'The kind of page you visit (no board or doc ids or titles), the referring domain, browser and device details, an approximate location from your IP address, and the events listed under Cookies'
      : config.site.analytics
        ? 'Page visits on the marketing pages'
        : '—',
    analyticsPurpose: ga
      ? 'Counting visits to our pages and the app, and a few actions such as sign-ups, with Google Analytics (you can opt out)'
      : config.site.analytics
        ? 'Counting visits to the marketing pages'
        : 'Not done on this service',
    analyticsBasis: ga ? 'Legitimate interests (understanding and improving the service); you can object by opting out' : '—',
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

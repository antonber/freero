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
      address: l.address ? escapeHtml(l.address) : unset('postal address'),
      jurisdiction: l.jurisdiction ? escapeHtml(l.jurisdiction) : unset('governing law'),
      contact: contact ? mailLink(contact) : unset('contact email'),
      abuseContact: abuse ? mailLink(abuse) : unset('abuse contact email'),
      securityContact: config.securityContact ? contactLink(config.securityContact) : contact ? mailLink(contact) : unset('security contact'),
      deletionGraceDays: days(config.accountDeletionGraceMs),
      exportExpiry: hoursOrDays(config.dataExportTtlMs),
      eventsRetentionDays: String(config.events.retentionDays),
      moderationKeepDays: days(config.moderationKeepRemovedMs),
      trashDays: String(TRASH_RETENTION_DAYS),
      auditRetentionDays: String(DEFAULT_AUDIT_RETENTION_DAYS),
      // Processors, as this server is configured right now (never a list someone has to keep in step).
      hosting: l.hosting ? escapeHtml(l.hosting) : unset('hosting provider and region'),
      mailProvider: config.smtpUrl ? `the email delivery service at ${code(hostOf(config.smtpUrl) ?? 'SMTP')}` : 'no email delivery service (this server sends no email)',
      storageProvider: config.s3
        ? `S3-compatible object storage at ${code(config.s3.endpoint ? (hostOf(config.s3.endpoint) ?? 'S3') : `Amazon S3 (${config.s3.region})`)}`
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
      analytics: config.site.analytics
        ? `These marketing pages (not the app) load an analytics script from ${code(new URL(config.site.analytics.src).origin)}, which counts page visits under its own privacy terms.`
        : 'These marketing pages load no analytics script, and the app has none.',
      status: l.statusUrl ? `<a href="${escapeHtml(l.statusUrl)}">${escapeHtml(l.statusUrl)}</a>` : 'there is no separate status page yet: write to the contact address below',
    },
  };
}

/** A page with its tokens filled; a legal page also loses its draft banner and noindex once in effect. */
export function withLegal(html: string, fill: LegalFill, legalPage: boolean): string {
  let out = html.includes('[[freero-legal:') ? html.replace(TOKEN, (m, key: string) => fill.values[key] ?? m) : html;
  if (legalPage && fill.inEffect) out = out.replace(BANNER, '').replace(DRAFT_ROBOTS, INDEX_ROBOTS);
  return out;
}

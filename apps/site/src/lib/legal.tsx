// The legal pages' deployment facts. Pages never hard-code who operates the service, how to reach
// them, the governing law or this server's retention settings: they put a token, and the server
// (modules/site/legal.ts) fills it in when it serves the page, like the origin. Keep the token
// syntax, the banner's markup and the draft robots meta in step with that file.
//
// A page with `legal: true` is built as a draft: the banner below and `noindex`. The server lifts
// both only once SITE_LEGAL_OPERATOR is set.
import type { ReactNode } from 'react';
import { Container } from '../components/ui';

/** What a token can stand for (each is filled with escaped text or a link). */
export type LegalKey =
  | 'operator'
  | 'atAddress'
  | 'postalAddress'
  | 'jurisdiction'
  | 'contact'
  | 'abuseContact'
  | 'securityContact'
  | 'deletionGraceDays'
  | 'exportExpiry'
  | 'eventsRetentionDays'
  | 'moderationKeepDays'
  | 'problemRetentionDays'
  | 'trashDays'
  | 'auditRetentionDays'
  | 'backupRetentionDays'
  | 'logRetentionDays'
  // Processors and services as the server is configured (modules/site/legal.ts derives them).
  | 'hosting'
  | 'mailProvider'
  | 'storageProvider'
  | 'aiProvider'
  | 'aiWorkspaces'
  | 'errorReporting'
  | 'analytics'
  | 'analyticsCookies'
  | 'analyticsProvider'
  | 'analyticsData'
  | 'analyticsPurpose'
  | 'analyticsBasis'
  | 'status';

/** A token in running text (a fragment, so pages can write `<p>Run by {L('operator')}.</p>`). */
export const L = (key: LegalKey) => <>{legal(key)}</>;

/** The page frame every legal page and /support shares: one h1, a date, an optional contents list. */
export function LegalArticle({ title, updated, intro, toc, children }: { title: string; updated: string; intro?: ReactNode; toc?: Array<[string, string]>; children: ReactNode }) {
  return (
    <Container>
      <article className="legal">
        <h1>{title}</h1>
        <p className="legal__meta">Last updated {updated}</p>
        {intro}
        {toc ? (
          <nav className="legal__toc" aria-label="Contents">
            <strong>Contents</strong>
            <ol>
              {toc.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`}>{label}</a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
        {children}
      </article>
    </Container>
  );
}

/** The token the server replaces (text position only, never inside an attribute). */
export const legal = (key: LegalKey): string => `[[freero-legal:${key}]]`;

/** Shown on a legal page until the operator is set (the server removes it then). */
export function DraftBanner() {
  return (
    <aside className="legal-draft" role="note">
      <strong>Draft: not in effect.</strong> This text is a working draft prepared for legal review. It is not an agreement and does not yet govern your use of
      the service.
    </aside>
  );
}

/**
 * The trust pages (/security, /subprocessors, /dpa) stay visibly under review until the operator
 * has had them reviewed and approves them: unlike the banner above, the server never removes this
 * line, whatever SITE_LEGAL_OPERATOR says. Approving a page = deleting <UnderReview /> from it.
 */
export function UnderReview() {
  return (
    <p className="legal-review" role="note">
      <strong>Draft — under review.</strong> This page is a draft pending legal review and the operator’s approval. It may change, and statements marked{' '}
      <ToConfirm /> have not been confirmed yet.
    </p>
  );
}

/** A statement the operator has yet to confirm (removed, with the statement fixed if need be, on approval). */
export function ToConfirm() {
  return <mark className="legal-confirm">to confirm by the operator</mark>;
}

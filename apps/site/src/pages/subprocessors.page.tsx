// DRAFT FOR LEGAL REVIEW, and under review until the operator approves it (`underReview: true`). Written
// from the server's configuration and the production deployment as far as the repository and the
// public service show it (2026-11-03); anything they don't show is marked <ToConfirm />. Providers the
// server is configured with are `L(...)` tokens (modules/site/legal.ts), so turning on AI or error
// tracking changes this list without anyone editing it.
import type { ReactNode } from 'react';
import { Table } from '../components/ui';
import { definePage } from '../lib/define';
import { L, LegalArticle, ToConfirm } from '../lib/legal';
import { abs, docsUrl } from '../lib/site';

const UPDATED = '2026-11-03';

/** A provider's name with where it processes the data under it. */
function Provider({ name, where }: { name: ReactNode; where: ReactNode }) {
  return (
    <>
      {name}
      <span className="legal-where">Where: {where}</span>
    </>
  );
}

export default definePage({
  path: '/subprocessors',
  name: 'Subprocessors',
  title: 'Subprocessors · Freero',
  description: 'The companies that process personal data for the hosted Freero service: what each does, which data it handles, where, and how you hear of changes.',
  updated: UPDATED,
  underReview: true,
  legal: true,
  closingCta: false,
  body: () => (
    <LegalArticle
      title="Subprocessors"
      updated={UPDATED}
      intro={
        <>
          <p>
            These are the companies that process personal data on behalf of {L('operator')} to run the Freero service at <a href={abs('/')}>{abs('/')}</a>.
            For organizations that use the service under our <a href="/dpa">data processing addendum</a>, they are our subprocessors. How we protect the data
            is in the <a href="/security">security overview</a>; what we collect and why is in the <a href="/privacy">privacy policy</a>.
          </p>
          <p>
            If you run Freero yourself, none of this applies to you: your server uses the providers you choose, under your own agreements with them.
          </p>
        </>
      }
      toc={[
        ['list', 'Subprocessors'],
        ['chosen', 'Services you choose to connect'],
        ['changes', 'How you hear about changes'],
      ]}
    >
      <h2 id="list">Subprocessors</h2>
      <p>
        The first six rows are filled in from this server’s own configuration when the page is served, so they always name what the service really uses.
      </p>
      <Table
        caption="Subprocessors of the hosted service"
        stack
        head={['Provider and where', 'What it does', 'Personal data it handles']}
        rows={[
          [
            <Provider name={L('hosting')} where="The region named, and the edge location nearest each visitor" />,
            <>
              Runs the application servers and the PostgreSQL database, and keeps request logs (up to {L('logRetentionDays')} days) and database backups (up to{' '}
              {L('backupRetentionDays')} days). Connections reach the service through the provider’s edge network, which terminates TLS at its location
              nearest to you, which can be outside the region named.
            </>,
            'Everything the service stores: accounts, boards, docs, comments, files’ index, the audit log, and request logs (IP address, account id, path)',
          ],
          [
            <Provider name={L('storageProvider')} where={<ToConfirm />} />,
            <>
              Stores uploaded files, board thumbnails, data-export archives and problem-report screenshots. The company that stores the files:{' '}
              <ToConfirm />
            </>,
            'Files people upload (which can contain anything, including voice and video in walkthrough recordings), screenshots attached to problem reports',
          ],
          [
            <Provider
              name={L('mailProvider')}
              where={
                <>
                  United States <ToConfirm />
                </>
              }
            />,
            'Delivers the service’s email: sign-in links, security notices, invitations, mentions and digests.',
            'Recipients’ email addresses and names, and the message: a board’s title, who invited or mentioned you, an excerpt of a comment (up to 280 characters), links',
          ],
          [
            <Provider name="AI model provider" where="Where that provider runs the model" />,
            <>
              {L('aiProvider')}. {L('aiWorkspaces')}
            </>,
            'When AI is on: the prompt and the board content an AI action reads. Freero stores neither',
          ],
          [<Provider name="Error tracking" where="Where that service runs" />, L('errorReporting'), 'When on: the error, the request’s method and path, and the account id'],
          [<Provider name="Analytics" where="Google may process it in the United States and elsewhere" />, L('analyticsProvider'), L('analyticsData')],
          [
            <Provider name="Porkbun (domain and DNS)" where="United States" />,
            'Registrar and DNS host of the service’s domain name. It answers DNS queries and does not carry or store the service’s traffic.',
            'None of the service’s data',
          ],
          [
            <Provider
              name={
                <>
                  Porkbun (email forwarding), and the operator’s mailbox provider <ToConfirm />
                </>
              }
              where={<ToConfirm />}
            />,
            'Receives mail sent to the service’s contact addresses (support, security, privacy) and forwards it to the operator’s mailbox.',
            'Whatever you write to us: your address, name and message, and any attachment',
          ],
          [
            <Provider
              name={
                <>
                  An AI assistant the operator uses to sort problem reports <ToConfirm />
                </>
              }
              where={<ToConfirm />}
            />,
            <>
              Reads new <strong>Report a problem</strong> submissions through the operator API to sort them and draft fixes. Issues it files in the public
              source repository carry no reporter data, board content or screenshots. Which provider, and its terms on retention and training:{' '}
              <ToConfirm />
            </>,
            'The note, screenshot and diagnostics of a problem report',
          ],
        ]}
      />
      <p>
        None of these providers receives your boards’ content unless the row says so, and none may use it for its own purposes. The service has no
        advertising partners and sells no personal data.
      </p>

      <h2 id="chosen">Services you choose to connect</h2>
      <p>
        These are not our subprocessors: they receive data only when you, or your workspace’s admins, decide to use them, and they handle it under their own
        terms with you.
      </p>
      <ul>
        <li>
          <strong>Sign-in providers</strong>: Google (“Continue with Google”) and your organization’s identity provider through single sign-on (SAML or
          OpenID Connect) or SCIM provisioning.
        </li>
        <li>
          <strong>Connected AI assistants and apps</strong> (Claude, ChatGPT and others) over the MCP server or the REST API: they receive what their
          requests return, within the permissions you granted.
        </li>
        <li>
          <strong>A workspace’s own AI provider</strong>, where this service lets team workspaces connect one (see the AI row above).
        </li>
        <li>
          <strong>Issue trackers</strong> (Jira, Linear, GitHub), <strong>webhooks</strong> and <strong>audit log streams to your SIEM</strong> at
          addresses your admins choose, and <strong>Slack</strong> link previews.
        </li>
        <li>
          <strong>Embedded content</strong> on a board (videos, design files, documents), which loads from its own site only after someone clicks it, and{' '}
          <strong>link previews</strong>, for which our server fetches the linked page.
        </li>
      </ul>

      <h2 id="changes">How you hear about changes</h2>
      <ul>
        <li>
          Before a new subprocessor starts processing personal data for the service, we add it here and change the date at the top, at least 30 days ahead
          except in an emergency (for example replacing a provider that failed) <ToConfirm />.
        </li>
        <li>
          Owners of team workspaces are emailed about additions <ToConfirm />. Organizations under the <a href="/dpa">data processing addendum</a> may object
          as it describes.
        </li>
        <li>
          Every change to this page is public: it is a file in the service’s open-source repository (
          <a href={docsUrl('apps/site/src/pages/subprocessors.page.tsx')}>its history</a>), and rows filled from the server’s configuration change when the
          configuration does.
        </li>
        <li>Questions: {L('contact')}.</li>
      </ul>
    </LegalArticle>
  ),
});

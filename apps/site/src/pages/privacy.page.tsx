// DRAFT FOR LEGAL REVIEW. Written from what the code does (docs/operations.md "Data map", checked
// against apps/server) by someone who is not a lawyer; it is not legal advice. The server shows it
// as "Draft: not in effect" and noindex until SITE_LEGAL_OPERATOR is set (modules/site/legal.ts).
// Facts that vary by deployment are `L(...)` tokens filled from this server's configuration.
import { Table } from '../components/ui';
import { definePage } from '../lib/define';
import { L, LegalArticle } from '../lib/legal';
import { abs } from '../lib/site';

const UPDATED = '2026-10-29';

export default definePage({
  path: '/privacy',
  name: 'Privacy policy',
  title: 'Privacy policy · Freero',
  description: 'What the Freero service collects, why, who processes it, how long it is kept, and how to see, export or delete your data.',
  updated: UPDATED,
  legal: true,
  closingCta: false,
  body: () => (
    <LegalArticle
      title="Privacy policy"
      updated={UPDATED}
      intro={
        <>
          <p>
            This policy explains what personal information the Freero service at <a href={abs('/')}>{abs('/')}</a> collects, what it is used for, who
            else handles it, how long it is kept, and what you can do about it. The service is operated by {L('operator')} (“we”, “us”), {L('address')}.
            Questions and requests: {L('contact')}.
          </p>
          <p>
            Freero is also open-source software that anyone can run. This policy covers only the service at this address. If you use a Freero server
            someone else runs (your employer’s, for example), that operator’s policy applies instead.
          </p>
        </>
      }
      toc={[
        ['collect', 'What we collect'],
        ['use', 'What we use it for'],
        ['ai', 'AI features and connected assistants'],
        ['share', 'Who else handles it'],
        ['cookies', 'Cookies and browser storage'],
        ['retention', 'How long we keep it'],
        ['rights', 'Your choices and rights'],
        ['workspaces', 'Team workspaces'],
        ['security', 'Security'],
        ['transfers', 'Where your data is processed'],
        ['children', 'Children'],
        ['changes', 'Changes to this policy'],
        ['contact', 'Contact'],
      ]}
    >
      <h2 id="collect">1. What we collect</h2>
      <h3>Your account</h3>
      <ul>
        <li>Your name, email address, cursor colour and, if you add one, a profile picture.</li>
        <li>
          Your password, stored only as a salted scrypt hash. If you turn on two-step verification, its secret (encrypted) and your recovery codes (hashed).
        </li>
        <li>If you sign in with a provider (such as Google or Microsoft) or your organization’s single sign-on: that provider’s identifier for you and the email address it gives us.</li>
        <li>Whether your email address is verified, when you joined, and your notification and email preferences.</li>
      </ul>
      <h3>What you create and share</h3>
      <ul>
        <li>
          Boards and docs and everything on them: notes, text, shapes, cards, drawings, comments, votes, templates you save, version history, and private
          drafts (which only you can see).
        </li>
        <li>Files you upload: images, PDFs, other attachments, and walkthrough recordings, which can contain your voice and, if you turn the camera on, your face.</li>
        <li>Answers, questions and upvotes in live activities. Ones marked anonymous are shown to others without your name, but the server still knows who sent them.</li>
        <li>Who you invite (their email address), who you share with, the roles you give, and requests for access.</li>
      </ul>
      <h3>When you use the service</h3>
      <ul>
        <li>
          For each signed-in browser: its IP address, browser and device type (user agent), how and when you signed in. We use these to show you your
          sessions, to tell you about sign-ins from a new browser and to protect your account. The location shown next to a session is estimated from the IP
          address on our own servers; the address is not sent to anyone for that.
        </li>
        <li>
          Request logs: the IP address, your account id, the page or API path (never the query string, request body, email address or password), the
          response and its timing.
        </li>
        <li>
          An audit log of security-relevant actions: sign-ins, changes to your sign-in methods, exports, sharing changes, and every call a connected app or
          token makes (the app, the tool or endpoint, the board, the outcome, the IP address).
        </li>
        <li>An activity feed of changes on each board (who changed what kind of item, when), shown to people on that board.</li>
        <li>
          Events about boards, used for the search index and for webhooks a team sets up: what changed, by whom, and the text of items and comments up to 280
          characters.
        </li>
      </ul>
      <h3>Visitors without an account</h3>
      <p>
        If a board’s owner lets guests in, you can join with only a name you choose. We keep that name and a guest session (a cookie, for 12 hours) and
        log requests as above.
      </p>
      <h3>Reports and messages</h3>
      <p>
        If you report content, we keep the report (the reason, your note, and your account or the contact address you give us). We don’t store the IP
        address you send it from: only a keyed hash of it, to see when one source floods the queue. If you write to us, we keep the correspondence.
      </p>
      <p>
        <strong>What we don’t do:</strong> we don’t sell personal information, show advertising, track you across other sites, or use your boards, docs or
        files to train AI models. {L('analytics')}
      </p>

      <h2 id="use">2. What we use it for</h2>
      <Table
        caption="Purposes and legal bases"
        stack
        head={['Purpose', 'What it involves', 'Legal basis (EEA / UK)']}
        rows={[
          ['Running the service', 'Accounts, boards, sharing, real-time collaboration, search, exports, notifications you asked for', 'Performing our contract with you'],
          ['Keeping accounts and the service safe', 'Sign-in protection, new-device notices, rate limits, the audit log, investigating abuse', 'Legitimate interests (security); legal obligations'],
          ['Moderation', 'Reviewing reports, removing content, suspending accounts, handling appeals', 'Legitimate interests (a safe service); legal obligations'],
          ['Emails about your account and boards', 'Verification, security notices, invitations, mentions and digests (you choose which digests you get)', 'Performing our contract; legitimate interests'],
          ['Operating and fixing the service', 'Logs, error reports and aggregate metrics (request counts and timings, never content)', 'Legitimate interests'],
          ['Legal requirements', 'Answering lawful requests, keeping records the law requires', 'Legal obligation'],
        ]}
      />
      <p>We don’t send marketing email. If that ever changes, it will be opt-in.</p>

      <h2 id="ai">3. AI features and connected assistants</h2>
      <h3>Freero’s built-in AI actions</h3>
      <p>
        Actions such as “Generate ideas”, “Cluster by theme” or “Summarise” send your prompt and the board content the action reads (the items you
        selected, or the board as you see it, never other people’s private drafts) to an AI model provider. On this service that is {L('aiProvider')}.{' '}
        {L('aiWorkspaces')} We don’t store your prompts, the content sent or the model’s answers; we keep usage counts (requests and tokens per month) and an
        audit entry for each request, without any text. The provider handles the request under its own terms.
      </p>
      <h3>Assistants and apps you connect (Claude, ChatGPT, others)</h3>
      <p>
        You can connect an AI assistant or another app to your account over Freero’s MCP server or REST API. Nothing is shared with an app until you connect
        it and approve the permissions on the consent screen (by default: read your boards and propose changes). A connected app acts for you, with your
        access, and only within those permissions. It receives what its requests return, such as board text, item ids and links; board content is marked as
        untrusted for the assistant. We receive the requests the app sends us, not your conversation with the assistant: the assistant’s provider handles that
        under its own privacy policy.
      </p>
      <p>
        When an assistant shows a board live in the conversation, the board loads from our servers into your browser with a short-lived token for that one
        board; it sets no cookies and the assistant doesn’t receive the board’s content through it. Every call an app makes is recorded in the audit log. You
        can disconnect an app or revoke a token at any time in Settings, and it stops working on its next request.
      </p>

      <h2 id="share">4. Who else handles it</h2>
      <h3>People you work with</h3>
      <p>
        What you put on a board is visible to the people who can open it: its members, the members of its team workspace, and anyone with its link if link
        sharing is on. Your name and cursor appear to people on the same board. Team workspace admins can see members, export the workspace and read its audit
        log (see <a href="#workspaces">Team workspaces</a>).
      </p>
      <h3>Service providers</h3>
      <p>These process data for us, under contract, only to run the service:</p>
      <Table
        caption="Service providers"
        stack
        head={['What', 'Who', 'Data']}
        rows={[
          ['Hosting and database', L('hosting'), 'Everything the service stores'],
          ['File storage', L('storageProvider'), 'Uploaded files, exports, board thumbnails'],
          ['Email delivery', L('mailProvider'), 'Your email address and the message'],
          ['AI model provider', L('aiProvider'), 'Prompts and board content of AI actions you run'],
          ['Error tracking', L('errorReporting'), 'Error details, request method and path, account id'],
          [
            'Web fonts',
            'Google Fonts (Google LLC)',
            'The app loads its fonts from Google’s servers, which receive your IP address and browser details when a page loads',
          ],
        ]}
      />
      <h3>Services you choose to connect</h3>
      <ul>
        <li>
          <strong>Sign-in providers</strong> (Google, Microsoft, your organization’s identity provider): if you sign in with one, it tells us who you are.
        </li>
        <li>
          <strong>Issue trackers</strong> (Jira, Linear, GitHub): if you or your team connect one, the items you send become issues there, and issue details come
          back onto your boards.
        </li>
        <li>
          <strong>Webhooks</strong>: admins of a team workspace can send the workspace’s board events to addresses they choose (for example a chat tool).
        </li>
        <li>
          <strong>Embedded content</strong>: a video, design file or call link someone puts on a board loads from its own site (which then sees your IP
          address) only after you click it.
        </li>
        <li>
          <strong>Link previews</strong>: when someone pastes a link, our server fetches that page to show its title and image. The site sees our server, not
          you.
        </li>
      </ul>
      <h3>When the law requires it</h3>
      <p>
        We disclose information when we must by law, or when it is necessary to protect someone’s safety, to investigate abuse of the service or to enforce
        our <a href="/terms">terms</a>. Where we are allowed to, we tell the person concerned first. If the service or its operator changes hands, this policy
        continues to apply to the data transferred, and we will tell you.
      </p>
      <p>
        <strong>We don’t sell or “share” personal information</strong> as the California Consumer Privacy Act defines those terms, and we have not done so in
        the past 12 months.
      </p>

      <h2 id="cookies">5. Cookies and browser storage</h2>
      <p>The app uses only cookies it needs to work. None are for advertising or analytics. The marketing pages set no cookies.</p>
      <Table
        caption="Cookies"
        stack
        head={['Cookie', 'What for', 'How long']}
        rows={[
          ['freero_session', 'Keeps you signed in', 'Up to 30 days, or until you sign out'],
          ['freero_device', 'Recognises this browser, so a sign-in from a new one can be reported to you', '400 days'],
          ['freero_2fa, freero_oidc, freero_sso, freero_tracker_oauth', 'Hold a sign-in or connection step in progress', '10 minutes'],
          ['freero_guest', 'Your guest session on a board, without an account', '12 hours'],
        ]}
      />
      <p>
        The app also keeps small preferences in your browser’s local storage (for example the last sticky-note colour you used), and an installed app keeps a
        copy of Freero’s own code for offline start-up. These never leave your device.
      </p>

      <h2 id="retention">6. How long we keep it</h2>
      <Table
        caption="Retention"
        stack
        head={['Data', 'Kept']}
        rows={[
          ['Your account, boards, docs and files', 'Until you delete them or your account'],
          ['A deleted account', <>Recoverable for {L('deletionGraceDays')} days, then deleted for good (boards you own go with it; team boards pass to a team owner)</>],
          ['Boards in the trash', <>{L('trashDays')} days (a team workspace can set a different period)</>],
          ['Version history of a board', 'Thinned over time (hourly for a day, daily for a month, weekly after); named versions are kept until you delete them'],
          ['Files no board, template or profile uses any more', 'Deleted within a day'],
          ['Your data export (ZIP)', <>{L('exportExpiry')}, then the file is deleted</>],
          ['Board events and webhook deliveries', <>{L('eventsRetentionDays')} days (deliveries 30 days)</>],
          ['Activity feed', '90 days'],
          ['Audit log', <>{L('auditRetentionDays')} days by default (a team workspace can set its own period)</>],
          ['Sign-in sessions and emailed links', 'Until they expire (minutes to 30 days) or you sign out'],
          ['Request logs', 'As long as our hosting provider keeps logs, at most 30 days'],
          ['Database backups', 'Up to 35 days, then overwritten'],
          [
            'Moderation records',
            <>
              Kept as the record of what was decided and why. A removed file’s kept copy is deleted after {L('moderationKeepDays')} days unless a report or appeal
              about it is still open.
            </>,
          ],
        ]}
      />
      <p>
        When your account is deleted, comments you wrote on other people’s boards stay on those boards with the author shown as “Deleted user”. Data still in
        backups disappears when the backup expires.
      </p>

      <h2 id="rights">7. Your choices and rights</h2>
      <ul>
        <li>
          <strong>See and export your data</strong>: Account settings → Your data → Download my data. You get a ZIP with your account details, your boards and
          docs, your comments on others’ boards, your files, memberships, notifications, app connections and activity, with a README explaining each file.
          Where a board’s settings allow downloads, you can also save a board as a <code>.freero</code> backup file.
        </li>
        <li>
          <strong>Correct it</strong>: change your name, email, picture and preferences in Account settings.
        </li>
        <li>
          <strong>Delete it</strong>: delete items, boards and files at any time; delete your whole account in Account settings → Delete account (signed out
          everywhere at once, recoverable for {L('deletionGraceDays')} days).
        </li>
        <li>
          <strong>Control apps</strong>: see, pause and disconnect connected apps and tokens in Settings.
        </li>
        <li>
          <strong>Emails</strong>: choose which notification emails you get, or unsubscribe from the link in any digest. Security notices can’t be turned off.
        </li>
      </ul>
      <p>
        Depending on where you live (for example under the GDPR in the EEA and UK, or the CCPA in California), you may also have the right to know what we hold
        about you, to object to or restrict some processing, to data portability, to withdraw consent, and not to be treated differently for exercising these
        rights. To use a right the settings don’t cover, write to {L('contact')} from the address on your account. We may ask you to confirm it is you, and
        we answer within one month (45 days under the CCPA). Someone you authorise can make a request for you if they can show they act for you. You can also
        complain to your local data protection authority.
      </p>

      <h2 id="workspaces">8. Team workspaces</h2>
      <p>
        If you work in a team workspace an organization runs, that organization decides who is in it and how its boards may be shared. Its admins can see
        members and their activity, export everything in the workspace, read its audit log, set retention periods and, with single sign-on or SCIM, manage
        your access. For data in such a workspace we act on the organization’s instructions, so some requests are best sent to its admins; we will help them
        answer you.
      </p>

      <h2 id="security">9. Security</h2>
      <p>
        Connections are encrypted (HTTPS). Passwords are hashed; two-step secrets, AI keys and integration tokens are encrypted at rest; tokens and API keys are
        stored only as hashes. Access by apps is limited to the permissions you grant, and every app call is audited. More on the{' '}
        <a href="/security">security page</a>. No system is perfectly secure: if we learn of a breach affecting your data, we will tell you and the
        authorities as the law requires. To report a vulnerability: {L('securityContact')}.
      </p>

      <h2 id="transfers">10. Where your data is processed</h2>
      <p>
        The service runs on {L('hosting')}. If you use it from elsewhere, your data is transferred there. Where the law requires safeguards for such transfers
        (for example from the EEA or UK), we rely on the European Commission’s standard contractual clauses or another lawful mechanism.
      </p>

      <h2 id="children">11. Children</h2>
      <p>
        Freero is not meant for children. You must be at least 16 to create an account. We don’t knowingly collect information from children under 16; if
        you believe a child has given us personal information, write to {L('contact')} and we will delete it.
      </p>

      <h2 id="changes">12. Changes to this policy</h2>
      <p>
        If we change this policy in a way that matters, we will tell you by email or in the app before the change takes effect. The date at the top says when
        it last changed.
      </p>

      <h2 id="contact">13. Contact</h2>
      <p>
        {L('operator')}, {L('address')}. Email: {L('contact')}. For help with the service, see <a href="/support">Support</a>.
      </p>
    </LegalArticle>
  ),
});

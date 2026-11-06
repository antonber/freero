// The security overview for buyers and reviewers (#109): how the hosted service and the software
// protect data, written from the code and the docs it links (docs/deployment.md "Encryption at
// rest", docs/operations.md, ARCHITECTURE.md), never from plans. Facts about the hosted service the
// repository can't show (the providers' encryption, console access, restore tests) are the operator's,
// approved on 2026-11-03, and the providers' as they document them. Deployment facts are `L(...)`
// tokens (modules/site/legal.ts).
import { Table } from '../components/ui';
import { definePage } from '../lib/define';
import { L, LegalArticle } from '../lib/legal';
import { abs, docsUrl, SOURCE_REPO } from '../lib/site';

const UPDATED = '2026-11-06';

export default definePage({
  path: '/security',
  name: 'Security',
  title: 'Security overview: how Freero protects your data',
  ogTitle: 'Security overview',
  description:
    'How the hosted Freero service and the open-source software protect data: hosting, encryption, SSO, SCIM, audit log, backups, incidents and AI.',
  updated: UPDATED,
  dateInBody: true,
  closingCta: false,
  faq: [
    {
      q: 'Is Freero SOC 2 or ISO 27001 certified?',
      a: 'No. Neither the hosted service nor the software holds a third-party certification or attestation yet. Its security architecture is documented and its code is public; organisations that need their own certified controls can host Freero themselves.',
    },
    {
      q: 'Where is my data stored?',
      a: 'On the hosted service, with its hosting provider in the United States, in one region. When you host Freero yourself, it is wherever you run it: your database, your S3-compatible storage, your network and region.',
    },
    {
      q: 'Can an AI agent read boards I didn’t share with it?',
      a: 'An agent acts for one person and can only reach boards that person can open, as that person sees them, within the permissions granted to the connection. A workspace can turn API and app access off, block a specific app, or restrict downloads so that apps can’t read its boards’ content.',
    },
  ],
  body: () => (
    <LegalArticle
      title="Security overview"
      updated={UPDATED}
      intro={
        <>
          <p>
            How the Freero service at <a href={abs('/')}>{abs('/')}</a>, operated by {L('operator')}, protects the data people put in it, and how the same
            software protects a server you run yourself. Everything here describes what the code does today; you can check each point in{' '}
            <a href={SOURCE_REPO}>the source code</a>. Also see the <a href="/subprocessors">subprocessors</a>, the{' '}
            <a href="/dpa">data processing addendum</a>, the <a href="/privacy">privacy policy</a> and our{' '}
            <a href={docsUrl('docs/security-questionnaire.md')}>answers to common security questionnaires</a>.
          </p>
          <p>
            <strong>Self-hosting</strong> runs under your own controls and certifications: your network, database, storage, keys, backups, logs and people.
            The software’s controls below apply there too; the parts about the hosted service don’t.
          </p>
        </>
      }
      toc={[
        ['glance', 'At a glance'],
        ['architecture', 'Architecture and data flows'],
        ['transit', 'Encryption in transit'],
        ['rest', 'Encryption at rest and keys'],
        ['identity', 'Sign-in, SSO, SCIM and sessions'],
        ['access', 'Access control'],
        ['isolation', 'Separation between customers'],
        ['agents', 'Apps, agents and the API'],
        ['audit', 'Audit log'],
        ['logging', 'Logging and monitoring'],
        ['appsec', 'Application security'],
        ['backups', 'Backups, retention and deletion'],
        ['availability', 'Availability'],
        ['operator', 'Our access to your data'],
        ['ai', 'AI and your data'],
        ['vulns', 'Vulnerability handling'],
        ['incidents', 'Incident response'],
        ['not-yet', 'What we don’t have yet'],
        ['self-hosting', 'Hosting it yourself'],
      ]}
    >
      <h2 id="glance">1. At a glance</h2>
      <Table
        caption="Security at a glance"
        stack
        head={['Area', 'The hosted service']}
        rows={[
          ['Hosting', L('hosting')],
          ['In transit', 'HTTPS only, HSTS for a year including subdomains, TLS certificates from Let’s Encrypt'],
          ['At rest', 'Credentials hashed, secrets sealed with AES-256-GCM; the database, its backups and files encrypted (AES-256) by the hosting provider'],
          ['Sign-in', 'Passwords (scrypt), Google, two-step verification, SAML and OpenID Connect SSO per workspace, SCIM 2.0'],
          ['Audit', <>Append-only, hash-chained per workspace, signed hourly checkpoints, streams to your SIEM, kept {L('auditRetentionDays')} days by default</>],
          ['Backups', <>Automated database backups by the hosting provider, kept up to {L('backupRetentionDays')} days</>],
          ['Certifications', 'None yet (no SOC 2, ISO 27001, HIPAA or PCI DSS)'],
          ['Source code', 'Public, MIT licensed'],
        ]}
      />

      <h2 id="architecture">2. Architecture and data flows</h2>
      <p>
        Freero is one server application, shipped as one container image, that serves the web app, the API, the MCP server and the live board connections.
        It keeps everything durable in PostgreSQL (accounts, boards and their version history, comments, the audit log) and files in S3-compatible object
        storage. Several instances can run side by side with Redis for shared rate limits and live updates between them.
      </p>
      <p>
        The hosted service runs one instance in one region: {L('hosting')}, with the provider’s managed PostgreSQL, reached over its private network, and
        a storage bucket ({L('storageProvider')}). There is no Redis: one instance doesn’t need it. Browsers connect over HTTPS and secure WebSockets to the provider’s edge network, which terminates TLS and forwards to the
        application. Its domain’s DNS is hosted at Porkbun.
      </p>
      <p>Data leaves the service only along these paths:</p>
      <ul>
        <li>Email: {L('mailProvider')}.</li>
        <li>Analytics: {L('analytics')}</li>
        <li>AI: {L('aiProvider')}. {L('aiWorkspaces')}</li>
        <li>Error tracking: {L('errorReporting')}</li>
        <li>
          What people and workspaces connect themselves: AI assistants and apps over MCP or the API, issue trackers, webhooks, audit log streams to a
          workspace’s SIEM, Slack link previews; and link previews and embeds on boards (see <a href="/subprocessors#chosen">services you choose</a>).
        </li>
      </ul>

      <h2 id="transit">3. Encryption in transit</h2>
      <ul>
        <li>
          Every page, API call and live connection uses HTTPS or secure WebSockets. Plain HTTP is redirected, and browsers are told to use HTTPS only
          (Strict-Transport-Security, one year, including subdomains).
        </li>
        <li>Session cookies are Secure, HttpOnly and SameSite=Lax, so they are never sent over plain HTTP or read by scripts.</li>
        <li>Email leaves over TLS to the email delivery service.</li>
        <li>
          The application reaches its database over the hosting provider’s private network, which the provider encrypts with WireGuard, and its
          storage bucket over HTTPS. A self-hosted server can require TLS to the database (<code>sslmode=require</code>), to Redis (<code>rediss://</code>) and to the
          bucket.
        </li>
      </ul>

      <h2 id="rest">4. Encryption at rest and keys</h2>
      <ul>
        <li>
          <strong>Credentials are never stored.</strong> Passwords are kept as salted scrypt hashes; session, API, OAuth and SCIM tokens, recovery codes and
          emailed links only as SHA-256 hashes. A copy of the database yields no working credential.
        </li>
        <li>
          <strong>Secrets are sealed by the application</strong> with AES-256-GCM: two-step verification keys, single sign-on client secrets, AI keys,
          tracker credentials, webhook addresses and signing secrets, SIEM stream credentials, board call links. The key is derived per purpose from the server’s one secret, which can
          be rotated without breaking sign-ins or links (<a href={docsUrl('docs/operations.md')}>rotation steps</a>).
        </li>
        <li>
          <strong>The database, its backups and files</strong> are encrypted at rest by the hosting provider, with AES-256 under keys it manages; this also
          covers its point-in-time recovery archives and its storage buckets. Board content is
          not encrypted by the application itself unless a workspace has its own key (below): an application-wide key would have to live next to the
          application that opens every board, so it would add little to storage encryption. <a href={docsUrl('docs/deployment.md')}>Why, in detail</a>.
        </li>
        <li>
          <strong>Keys:</strong> the server’s secret is held only in the hosting provider’s environment variables, which it keeps envelope-encrypted and
          decrypts only to hand to the running service; it is never in the code or the image. A
          self-hosted server can encrypt its bucket with its own AWS KMS key (<code>S3_SSE=aws:kms</code>) and its database volume with its cloud’s KMS.
        </li>
        <li>
          <strong>Workspace encryption keys</strong> are part of the software and off by default. When a server’s operator turns them on (
          <code>WORKSPACE_KEYS</code>), a team workspace’s security admins can keep its board content and the files uploaded to its boards sealed with
          AES-256-GCM under data keys wrapped by the server’s key or by the workspace’s own key in AWS KMS, Google Cloud KMS, Azure Key Vault or a
          HashiCorp Vault Transit engine; suspending or destroying the key closes the workspace’s boards at once. They are not turned on for the hosted
          service yet, so today customer-managed keys mean hosting Freero yourself. <a href={docsUrl('docs/configuration.md')}>Configuration</a>.
        </li>
      </ul>

      <h2 id="identity">5. Sign-in, SSO, SCIM and sessions</h2>
      <ul>
        <li>Passwords of at least 8 characters, hashed with scrypt; sign-in is rate-limited per address and per network, with uniform timing for unknown addresses.</li>
        <li>Continue with Google; two-step verification with an authenticator app and recovery codes, and a safe recovery path when the phone is lost.</li>
        <li>
          <strong>Single sign-on per team workspace</strong>, SAML 2.0 or OpenID Connect, for domains the workspace has proven with a DNS record.
          Assertions must be signed and are checked for audience, recipient, time and replay; a response to a sign-in must answer one Freero started, once.
          Sign-in from the identity provider’s own app tile (IdP-initiated SAML) is refused unless the workspace turns it on; then the response must also
          name Freero as its destination, and its return path can only be a page of Freero. “Enforce SSO” keeps one owner as break-glass and also covers
          tokens and apps made without SSO.
        </li>
        <li>
          <strong>SCIM 2.0 provisioning</strong> from directories such as Okta and Microsoft Entra ID: groups map to workspace roles, and deprovisioning ends a
          person’s access, sessions and tokens at once.
        </li>
        <li>
          <strong>Domain control</strong> for a verified domain, with or without SSO: admins bring existing accounts at the domain into the workspace (each
          person is emailed first and can opt out by changing their address), new sign-ups at the domain can join automatically, and creating other team
          workspaces with a domain address can be blocked.
        </li>
        <li>
          <strong>Session policies</strong> per workspace: a maximum session length (1 hour to 90 days; 30 days by default), an idle timeout (15 minutes to 30
          days) and required two-step verification. The strictest policy of a person’s workspaces applies to all their sessions, and expired sessions are
          ended everywhere within a minute.
        </li>
        <li>
          People see their sessions with an approximate location and can end any of them. An email goes out when a password, address, two-step setting or
          sign-in method changes, or a new browser signs in. Signing out everywhere also revokes tokens and app connections.
        </li>
      </ul>

      <h2 id="access">6. Access control</h2>
      <ul>
        <li>
          Boards have four roles, enforced by the server on every request and live connection: owner, editor, commenter and viewer. A viewer’s connection
          can’t write, whatever its client sends.
        </li>
        <li>Team workspaces have owners, admins, members and guests; admins manage members, policies, single sign-on, provisioning and the audit log.</li>
        <li>
          Sharing is by invitation or by link with a chosen role, an optional password and an expiry date. Workspace policies decide who may share, invite
          guests, export, download or connect apps.
        </li>
        <li>
          Private drafts and hidden frames are withheld by the server, so they never reach a person, an app, a webhook or the search index that may not see
          them.
        </li>
        <li>Deactivating a member closes the workspace’s boards to them at once, on every connection.</li>
      </ul>

      <h2 id="isolation">7. Separation between customers</h2>
      <p>
        The hosted service is multi-tenant: all workspaces share one application and one database. Separation is logical. Every read and write, over HTTP,
        WebSockets, the API and MCP, goes through one server-side permission check that resolves the requester’s role on that board and the workspace’s
        policies. Search, exports, AI actions and webhooks read through the same check. Images and other files placed on boards are served at
        unguessable random addresses (anyone who has a file’s address can load it); attachments are downloaded only through their board, with its access
        check. Organisations that need physical separation can host their own Freero.
      </p>

      <h2 id="agents">8. Apps, agents and the API</h2>
      <ul>
        <li>
          Every app, agent and script holds a credential that acts for one person, never beyond that person’s access, and only within the permissions granted
          on the consent screen. MCP connections get read and suggest by default; writing and commenting are opt-in.
        </li>
        <li>
          OAuth 2.1 with mandatory PKCE, one-hour access tokens, rotating refresh tokens (a replayed one ends the whole consent), and tokens bound to the API
          or the MCP server they were issued for.
        </li>
        <li>
          Board text reaches agents inside an untrusted-content envelope that board text can’t close, so content on a board can’t pose as instructions.
        </li>
        <li>
          Kill switches: pause or revoke a token, disconnect an app or everything at once, block an app for a workspace, turn API access off for a workspace or
          the whole service. Each works on the next request.
        </li>
        <li>Each credential has its own request and write limits, and every call it makes is recorded in the audit log.</li>
      </ul>

      <h2 id="audit">9. Audit log</h2>
      <ul>
        <li>
          Records sign-ins and failed sign-ins, session and sign-in-method changes, sharing and role changes, exports and downloads, single sign-on and SCIM
          events, workspace settings, every API and MCP call, AI requests (never their text) and actions by the service’s operators.
        </li>
        <li>
          Append-only: the application has no way to edit or delete entries, and a database trigger refuses changes outside retention. Each workspace’s log is
          a hash chain (SHA-256), so an edited, missing or reordered entry shows when the chain is checked.
        </li>
        <li>
          Every hour the server signs a checkpoint of each chain’s newest entry, so even someone able to rewrite the database can’t rewrite a chain without
          the check failing, unless they also hold the server’s secret.
        </li>
        <li>
          Admins filter it, check its integrity in the admin console and export it as CSV or JSON with each entry’s hashes, so it can be verified
          independently. Retention per workspace: 30 to 3,650 days, {L('auditRetentionDays')} by default.
        </li>
        <li>
          <strong>Streaming to your SIEM</strong>: Splunk (HTTP Event Collector), Microsoft Sentinel, any HTTPS collector (requests signed like webhooks) or
          syslog over TLS, in order and at least once, with every entry’s hashes and a signed chain head every hour, so the chain also lives outside
          Freero. Stream credentials are sealed and never shown again; streams go only to HTTPS or TLS endpoints on the public internet. SIEMs that pull use
          the audit log in the REST API (an <code>audit:read</code> token of a workspace owner or admin).
        </li>
      </ul>

      <h2 id="logging">10. Logging and monitoring</h2>
      <ul>
        <li>
          One structured log line per request: request id, account id, method, path without query string, status, timing and IP address. Request bodies,
          cookies, authorization headers, passwords, tokens and secrets are never logged. The hosting provider keeps logs up to {L('logRetentionDays')} days.
        </li>
        <li>Health and readiness checks gate every deploy; metrics are available to the operator only.</li>
        <li>{L('errorReporting')}</li>
        <li>
          The hosted service has no automated alerting or paging yet. A deploy takes traffic only once its readiness check passes, the image is smoke-tested
          before every deploy and the live service after it, and the operator watches the hosting provider’s health and
          deploy status. Problem reports people send are sorted every weekday.
        </li>
      </ul>

      <h2 id="appsec">11. Application security</h2>
      <ul>
        <li>
          A strict Content-Security-Policy (scripts only from Freero itself, plus Google’s tag script where analytics is on, never on embedded
          boards), frame-ancestors none,
          nosniff, a strict referrer policy and a restrictive permissions policy on every response.
        </li>
        <li>Every state-changing request and WebSocket upgrade from another site is refused (cross-site request forgery and WebSocket hijacking).</li>
        <li>
          Uploads are recognised by their bytes, stored under random names and served with a sandboxing policy: anything that isn’t a known image, PDF or
          media file downloads as an attachment and never runs in Freero’s origin.
        </li>
        <li>
          Outbound requests (link previews, webhooks, issue trackers, AI endpoints a workspace types in) use HTTPS and refuse private, loopback and link-local
          addresses, also after DNS resolution.
        </li>
        <li>Rate limits on sign-in, sign-up, two-step codes, password changes, uploads, invitations, reports, AI, exports, search and the API.</li>
        <li>
          Every change runs type checks, architecture-boundary checks and the test suite in continuous integration, and the container image is built and
          smoke-tested before a deploy. Changes to the hosted service, to its code or its configuration, are made only by the operator.
        </li>
        <li>Automated dependency vulnerability scanning and an independent penetration test are not in place yet.</li>
      </ul>

      <h2 id="backups">12. Backups, retention and deletion</h2>
      <ul>
        <li>
          The hosting provider backs up the database automatically, with point-in-time recovery, daily backups kept 6 days and weekly backups kept 27
          days, all encrypted at rest; no backup is kept longer than {L('backupRetentionDays')} days. We test restoring a backup at least once a quarter.
        </li>
        <li>
          Uploaded files are kept in the storage bucket. It keeps no earlier versions of a file (the provider’s buckets don’t support object
          versioning), so a deleted file is not kept there.
        </li>
        <li>
          People can export their own data, and workspace admins a whole workspace, at any time. Boards in the trash are deleted for good after{' '}
          {L('trashDays')} days (a workspace can choose), a deleted account after {L('deletionGraceDays')} days, files nothing uses within a day.
        </li>
        <li>
          Copies in backups are not edited out: they go when the backup expires. Retention of everything else is in the{' '}
          <a href="/privacy#retention">privacy policy</a>.
        </li>
      </ul>

      <h2 id="availability">13. Availability</h2>
      <p>
        The hosted service runs as one instance in one region. Deploys only take traffic once the new version answers its readiness check, open boards are
        saved before an instance stops, and a crashed process restarts on its own. There is no standby in a second region and no service-level agreement.
        Status: {L('status')}.
      </p>

      <h2 id="operator">14. Our access to your data</h2>
      <ul>
        <li>
          The service has no feature for operators to sign in as a user or browse boards. Operators, a short list fixed in the server’s configuration (not
          in the database), can see content only through the moderation queue when someone reports it, and problem reports people send them; every
          moderation action is audited.
        </li>
        <li>
          Today one person, the operator’s owner, holds the accounts that reach the production database, storage and configuration, the source
          repository and the domain: the consoles of the hosting provider, GitHub and the registrar. We require two-step verification on each of them.
          Anything done with the operator command-line tools is recorded in the audit log of the account and workspaces it affects.
        </li>
        <li>We open a board you send us only if you ask us to.</li>
      </ul>

      <h2 id="ai">15. AI and your data</h2>
      <ul>
        <li>
          Freero has no AI model of its own. On this service: {L('aiProvider')}. {L('aiWorkspaces')}
        </li>
        <li>
          When AI is on, an action sends the person’s prompt and only the board content that person can see (never others’ private drafts) to that provider.
          Freero stores neither the prompt, the content sent nor the answer; it keeps usage counts and an audit entry without any text. Workspaces that
          restrict downloads also keep their content away from AI actions.
        </li>
        <li>Freero never uses boards, docs or files to train AI models.</li>
        <li>
          To sort the problem reports people send us, the operator uses an AI assistant, Anthropic’s Claude Code, which reads them through a token
          limited to problem reports (see <a href="/subprocessors">subprocessors</a>).
        </li>
        <li>
          Assistants people connect (Claude, ChatGPT and others) receive only what their requests return, within the permissions granted; the assistant’s
          provider handles the conversation under its own terms. <a href={docsUrl('docs/ai.md')}>AI in Freero</a> has the details.
        </li>
      </ul>

      <h2 id="vulns">16. Vulnerability handling</h2>
      <p>
        Report a vulnerability to {L('securityContact')} (also in <code>/.well-known/security.txt</code>). The disclosure policy, with what
        is in scope and how we respond, is <a href={docsUrl('SECURITY.md')}>SECURITY.md</a> in the source repository. We ask for time to fix an issue before it
        is made public, and credit reporters who want it. There is no paid bug bounty.
      </p>

      <h2 id="incidents">17. Incident response</h2>
      <ul>
        <li>
          A written procedure covers assessing an incident, mitigating first (rolling back, revoking credentials, turning integrations off), recovering data,
          and a written review afterwards with a check that would have caught it (<a href={docsUrl('docs/operations.md')}>operations guide</a>).
        </li>
        <li>
          Credentials can be revoked for one person, one app, a whole workspace or the whole service, effective on the next request; everyone can be signed
          out at once.
        </li>
        <li>
          If a breach affects personal data, we tell the people and organisations affected without undue delay and the authorities as the law requires; for
          organisations under the <a href="/dpa">DPA</a>, as it says.
        </li>
      </ul>

      <h2 id="not-yet">18. What we don’t have yet</h2>
      <ul>
        <li>No SOC 2 report, ISO 27001 certificate or other third-party attestation, and no HIPAA or PCI DSS compliance.</li>
        <li>No independent penetration test and no automated dependency vulnerability scanning.</li>
        <li>No choice of data region, no second region and no service-level agreement.</li>
        <li>No automated alerting or on-call paging for the hosted service.</li>
        <li>No customer-managed encryption keys on the hosted service yet: workspace keys are built but not turned on there.</li>
        <li>No SAML single logout and no encrypted SAML assertions.</li>
      </ul>

      <h2 id="self-hosting">19. Hosting it yourself</h2>
      <p>
        Freero is open source and runs anywhere Docker does, so an organisation can keep everything in its own environment, under its own certifications:
        your region, database, storage and KMS keys, identity provider, logging pipeline and backups. Start with{' '}
        <a href={docsUrl('docs/deployment.md')}>deployment</a> (including the encryption-at-rest table, short enough for a questionnaire),{' '}
        <a href={docsUrl('docs/operations.md')}>operations</a> (backups, key rotation, incident basics) and{' '}
        <a href={docsUrl('docs/configuration.md')}>every setting</a>.
      </p>
    </LegalArticle>
  ),
});

import { Card, Cards, Checks, Hero, Section } from '../components/ui';
import { definePage } from '../lib/define';
import { docsUrl, SOURCE_REPO } from '../lib/site';

export default definePage({
  path: '/security',
  name: 'Security',
  title: 'Security: how Freero protects boards, people and agents',
  ogTitle: 'Security for boards, people and agents',
  description:
    'Read-and-suggest agents, untrusted-content handling, server-side private layers, SSO, SCIM, an append-only audit log and kill switches. All open source.',
  updated: '2026-10-28',
  faq: [
    {
      q: 'Is Freero SOC 2 or ISO 27001 certified?',
      a: 'No. Freero is a free, open-source project and does not hold third-party certifications. Its security architecture is documented and its code is public; organisations that need their data to stay in their own environment can host Freero themselves.',
    },
    {
      q: 'Where is my data stored?',
      a: 'In the PostgreSQL database and the file storage of the Freero server you use. When you host Freero yourself, that is wherever you run it: your database, your S3-compatible storage, your network and region.',
    },
    {
      q: 'Can an AI agent read boards I didn’t share with it?',
      a: 'An agent acts for one person and can only reach boards that person can open, as that person sees them, within the permissions granted to the connection. A workspace can turn API and app access off, block a specific app, or restrict downloads so that apps can’t read its boards’ content.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Security"
        title="Built so people stay in charge of the board."
        lead="Freero lets AI agents work on the same boards as people. That only works if agents can’t see more than they should, can’t be talked into things by board content, and can be switched off instantly. Here is how."
      />

      <Section id="agents" title="Agents and integrations" lead="Every app, agent and script is a credential that acts for one person, checked on every request.">
        <Cards cols={3}>
          <Card title="Least power by default">
            MCP connections get read and suggest. Writing and commenting are opt-in scopes, and a credential never exceeds its person’s role on the board.
          </Card>
          <Card title="Untrusted content boundary">
            Board text reaches agents only inside an untrusted-content envelope that board text can’t close. Tool names, descriptions and errors are Freero’s own
            words, never board text.
          </Card>
          <Card title="Server-side privacy">
            Private-mode drafts and hidden frames are withheld by the server, so they never reach an agent, a webhook or the search index for people who can’t
            see them.
          </Card>
          <Card title="Bound, short-lived tokens">
            OAuth 2.1 with mandatory PKCE, one-hour access tokens, rotating refresh tokens (a replayed one ends the whole consent), tokens bound to the API or the
            MCP server they were issued for. Only hashes are stored.
          </Card>
          <Card title="Kill switches">
            Pause or revoke a token, disconnect an app, disconnect everything at once, block an app for a team, turn API access off for a team, or for the whole
            instance. Effective on the next request.
          </Card>
          <Card title="Audit and limits">
            Every API and MCP call is an audit event. Each credential has its own request and write budget, separate from people’s editing.
          </Card>
        </Cards>
      </Section>

      <Section id="accounts" tone="tint" title="Accounts and sign-in">
        <div className="columns-2">
          <Checks
            kind="yes"
            items={[
              'Passwords hashed with scrypt; sign-in rate-limited per address and per network',
              'Two-step verification with an authenticator app and recovery codes',
              'Sign in with Google or Microsoft, and SAML or OpenID Connect SSO per workspace',
              'Enforced SSO also applies to tokens and apps made without it',
            ]}
          />
          <Checks
            kind="yes"
            items={[
              'An email when your password, address, two-step setup or sign-in methods change, or a new browser signs in',
              'See your sessions with their approximate location and sign out any of them',
              'Signing out everywhere also revokes tokens and app connections',
              'SCIM 2.0 deprovisioning ends a person’s access, sessions and tokens',
            ]}
          />
        </div>
      </Section>

      <Section id="boards" title="Boards and sharing">
        <Cards cols={3}>
          <Card title="Roles enforced by the server">Owner, editor, commenter and viewer. A viewer’s connection can’t write, whatever its client sends.</Card>
          <Card title="Share links you control">Invite by email or share a link with a chosen role, an optional password and an expiry date; guests can be allowed or not.</Card>
          <Card title="Workspace policies">Who may share, invite guests, export or download; session length and idle timeouts; live embeds on or off.</Card>
          <Card title="Uploads that can’t run">Files are recognised by their bytes; anything that isn’t a known image, PDF or media file downloads as an attachment and never runs in Freero’s origin.</Card>
          <Card title="Outbound requests checked">Link previews, webhooks, tracker and AI endpoints use https and refuse private, loopback and link-local addresses, also after DNS, unless the operator allows a private network.</Card>
          <Card title="Secrets sealed at rest">Two-step secrets, tracker credentials, AI keys and webhook secrets are encrypted with AES-256-GCM under a rotatable key.</Card>
        </Cards>
      </Section>

      <Section id="platform" tone="tint" title="Platform" narrow>
        <Checks
          kind="yes"
          items={[
            'A strict Content-Security-Policy, HSTS over HTTPS, and frame-ancestors none',
            'Cross-site request checks on every state-changing request and WebSocket upgrade',
            'Rate limits on sign-in, sign-up, uploads, invitations, AI, the API and more, shared across instances through Redis',
            'An append-only audit log, hash-chained per workspace, with export and an integrity check',
            'Personal and workspace data exports, and account deletion with a grace period (GDPR)',
            'Abuse reporting and a moderation queue for whoever operates the server',
          ]}
        />
        <p>
          Freero has no AI model of its own: built-in AI actions are off until a provider is configured, and Freero doesn’t store prompts or answers. See{' '}
          <a href={docsUrl('docs/ai.md')}>AI in Freero</a>.
        </p>
        <p>
          Everything here is in the open: <a href={SOURCE_REPO}>the source code</a>, <a href={docsUrl('ARCHITECTURE.md')}>the architecture</a> and{' '}
          <a href={docsUrl('docs/configuration.md')}>every setting</a>. Report a vulnerability to the contact in the server’s{' '}
          <code>/.well-known/security.txt</code>.
        </p>
      </Section>
    </>
  ),
});

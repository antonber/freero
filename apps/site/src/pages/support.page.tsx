// How to get help, report abuse or a vulnerability, and check the service's status. The contacts
// are `L(...)` tokens filled from this server's configuration (SITE_LEGAL_CONTACT_EMAIL,
// ABUSE_CONTACT_EMAIL, SECURITY_CONTACT, SITE_STATUS_URL; modules/site/legal.ts).
import { definePage } from '../lib/define';
import { L, LegalArticle } from '../lib/legal';
import { abs, APP, docsUrl } from '../lib/site';

const UPDATED = '2026-10-29';

export default definePage({
  path: '/support',
  name: 'Support',
  title: 'Freero support: help, abuse reports and security',
  ogTitle: 'Help and support',
  description: 'Get help with Freero, report abuse or a security issue, manage your data and connected AI apps, and check whether the service is up.',
  updated: UPDATED,
  closingCta: false,
  body: () => (
    <LegalArticle
      title="Help and support"
      updated={UPDATED}
      intro={<p>Most questions are answered in the guides below. If yours isn’t, write to {L('contact')}: a person reads every message.</p>}
      toc={[
        ['help', 'Getting help'],
        ['ai', 'Claude, ChatGPT and other connected apps'],
        ['data', 'Your account and data'],
        ['abuse', 'Reporting abuse'],
        ['security', 'Reporting a security issue'],
        ['status', 'Service status'],
      ]}
    >
      <h2 id="help">Getting help</h2>
      <ul>
        <li>
          <a href="/docs">Documentation</a>: connecting assistants, the API and webhooks, issue trackers, and running Freero yourself.
        </li>
        <li>
          Email {L('contact')}. Say what you were doing, what you expected and what happened, and include the board’s link if it is about a board (we only
          open a board you send us if you ask us to).
        </li>
      </ul>

      <h2 id="ai">Claude, ChatGPT and other connected apps</h2>
      <ul>
        <li>
          Connect one: in Freero, Settings → AI agents → <a href={APP.connect}>Connect an agent</a>, or see <a href="/claude">Freero for Claude</a> and{' '}
          <a href="/chatgpt">Freero for ChatGPT</a>. The server address is <code>{abs('/mcp')}</code>.
        </li>
        <li>
          An app can only do what you allowed on the consent screen (by default: read boards and propose changes). If it says it lacks a permission,
          disconnect it in Settings → Connected apps and connect it again with that permission ticked.
        </li>
        <li>Stop an app at once: Settings → Connected apps → Disconnect (or “Disconnect all apps and tokens”). It stops on its next request.</li>
        <li>
          Reference for every tool: <a href={docsUrl('docs/mcp.md')}>MCP server guide</a>.
        </li>
      </ul>

      <h2 id="data">Your account and data</h2>
      <ul>
        <li>Download everything: Account settings → Your data → Download my data.</li>
        <li>
          Delete your account: Account settings → Delete account. You can change your mind for {L('deletionGraceDays')} days by signing in again.
        </li>
        <li>Locked out by two-step verification: use a recovery code, or “Lost access to your authenticator?” on the sign-in page.</li>
        <li>
          Any other request about your personal data: {L('contact')}. See the <a href="/privacy">privacy policy</a>.
        </li>
      </ul>

      <h2 id="abuse">Reporting abuse</h2>
      <p>
        If something on a board breaks the <a href="/acceptable-use">acceptable use policy</a>, report it from the board: <strong>Report board…</strong> in the
        board menu, <strong>Report…</strong> on the right-click menu of an item or a file, or Report on a comment. The report goes to our moderators with
        exactly what you pointed at; the board’s owner never learns who reported it. You can also write to {L('abuseContact')} with the board’s link and what
        is wrong. For copyright or other rights complaints, include who owns the rights and where the content is. If you were affected by a moderation
        decision, the email you received has a link to appeal it.
      </p>

      <h2 id="security">Reporting a security issue</h2>
      <p>
        Please report vulnerabilities privately to {L('securityContact')} (also listed in <code>/.well-known/security.txt</code>), with steps to
        reproduce. Test only against your own accounts and boards, don’t access other people’s data, and don’t disrupt the service. We will confirm we
        received your report, keep you updated, and credit you if you wish once it is fixed.
      </p>

      <h2 id="status">Service status</h2>
      <p>If Freero isn’t loading or a feature stopped working: {L('status')}.</p>
    </LegalArticle>
  ),
});

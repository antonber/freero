// DRAFT FOR LEGAL REVIEW (not legal advice). The rules moderation enforces (docs/operations.md
// "Moderation"). Draft banner and noindex until SITE_LEGAL_OPERATOR is set (modules/site/legal.ts).
import { definePage } from '../lib/define';
import { L, LegalArticle } from '../lib/legal';

const UPDATED = '2026-10-29';

export default definePage({
  path: '/acceptable-use',
  name: 'Acceptable use',
  title: 'Acceptable use policy · Freero',
  description: 'What you may not use the Freero service for, how to report content that breaks the rules, and what happens when someone does.',
  updated: UPDATED,
  legal: true,
  closingCta: false,
  body: () => (
    <LegalArticle
      title="Acceptable use policy"
      updated={UPDATED}
      intro={
        <p>
          This policy is part of the <a href="/terms">terms of service</a> between you and {L('operator')}. It applies to everything on the service: boards, docs, comments, files, names,
          and what you or apps acting for you do through the API and MCP server.
        </p>
      }
    >
      <h2 id="content">Content that isn’t allowed</h2>
      <ul>
        <li>Anything that sexually exploits or endangers children. We remove it, keep what the law requires, and report it to the authorities.</li>
        <li>Content that is illegal where you are or where we operate, or that helps someone break the law.</li>
        <li>Threats of violence, incitement, or content that promotes terrorism or violent extremism.</li>
        <li>Harassment, bullying, or content that attacks people for who they are (such as race, ethnicity, religion, disability, gender or sexual orientation).</li>
        <li>Sexually explicit material, and any intimate image shared without the consent of the person in it.</li>
        <li>Someone else’s private information (addresses, identity documents, financial or health details) shared without their permission.</li>
        <li>Content that infringes someone’s copyright, trademark or other rights.</li>
        <li>Scams, phishing, impersonation of a person or organization, and misleading content designed to deceive.</li>
        <li>Malware, or links and files that harm the people who open them.</li>
      </ul>

      <h2 id="behaviour">Things you may not do</h2>
      <ul>
        <li>Send spam, or use boards, comments, invitations or share links to advertise or to mass-message people who didn’t ask for it.</li>
        <li>Use Freero mainly as a file host or to distribute files unrelated to working on boards and docs.</li>
        <li>
          Try to get into accounts, boards or data you haven’t been given access to, probe or scan the service for weaknesses, or disrupt it (for example by
          overloading it). Good-faith security research is welcome when it follows our security reporting guidelines (see <a href="/support#security">Support</a>
          ).
        </li>
        <li>Get around limits, permissions, a suspension or a workspace’s policies, including by creating more accounts or by using apps, tokens or agents.</li>
        <li>
          Write board content meant to manipulate other people’s AI assistants or agents (hidden instructions, “prompt injection”), or use an agent to act
          beyond what the person it works for asked.
        </li>
        <li>Collect other users’ information (scraping names or email addresses, for example) or use the service to track people.</li>
        <li>Resell or rebrand the hosted service as your own without our written permission. (You are free to run the open-source software yourself.)</li>
      </ul>

      <h2 id="report">Reporting</h2>
      <p>
        Anyone who can open a board can report it: <strong>Report board…</strong> in the board menu, <strong>Report…</strong> on the right-click menu of an
        item or file, or Report on a comment. You don’t need an account to report a board you can open through its link. You can also write to{' '}
        {L('abuseContact')}. The board’s owner never learns who reported it.
      </p>

      <h2 id="enforcement">What happens</h2>
      <p>
        We review reports and, depending on how serious it is, may turn off a board’s link, take a board down for review, remove a file, or suspend an
        account. The person affected gets an email with what we did, why, and a link to appeal; a person reviews every appeal. We may also act without a
        report when we find content that breaks these rules, and we may report illegal content to the authorities.
      </p>
    </LegalArticle>
  ),
});

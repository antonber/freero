// DRAFT FOR LEGAL REVIEW. Written by someone who is not a lawyer from what the service does; not
// legal advice. Shown as "Draft: not in effect" and noindex until SITE_LEGAL_OPERATOR is set
// (modules/site/legal.ts). Operator, address, governing law and contacts are `L(...)` tokens.
import { definePage } from '../lib/define';
import { L, LegalArticle } from '../lib/legal';
import { abs, SOURCE_REPO } from '../lib/site';

const UPDATED = '2026-10-29';

export default definePage({
  path: '/terms',
  name: 'Terms of service',
  title: 'Terms of service · Freero',
  description: 'The terms for using the hosted Freero service: your account, your content, AI features and connected apps, moderation, and liability.',
  updated: UPDATED,
  legal: true,
  closingCta: false,
  body: () => (
    <LegalArticle
      title="Terms of service"
      updated={UPDATED}
      intro={
        <p>
          These terms are an agreement between you and {L('operator')} (“we”, “us”), {L('address')}, for using the Freero service at{' '}
          <a href={abs('/')}>{abs('/')}</a>, its apps, its API and its MCP server (together, “the service”). By creating an account or using the service you
          accept them, together with the <a href="/acceptable-use">acceptable use policy</a>. Our <a href="/privacy">privacy policy</a> explains how we handle
          personal information.
        </p>
      }
      toc={[
        ['who', 'Who can use Freero'],
        ['service', 'The service'],
        ['account', 'Your account'],
        ['content', 'Your content'],
        ['ai', 'AI features and connected apps'],
        ['rules', 'Rules and moderation'],
        ['third', 'Other services'],
        ['fees', 'Price'],
        ['ending', 'Ending the agreement'],
        ['warranty', 'Disclaimers'],
        ['liability', 'Limits on liability'],
        ['law', 'Governing law and disputes'],
        ['changes', 'Changes to these terms'],
        ['general', 'General'],
      ]}
    >
      <h2 id="who">1. Who can use Freero</h2>
      <p>
        You must be at least 16 years old and able to enter into this agreement. If you use the service for an organization, you confirm you may accept these
        terms for it, and “you” includes that organization.
      </p>

      <h2 id="service">2. The service</h2>
      <p>
        Freero is a collaborative whiteboard with docs, real-time editing, sharing, integrations, optional AI features, and a REST API and MCP server for apps
        and AI assistants. The software is open source under the MIT licence (<a href={SOURCE_REPO}>source</a>); that licence governs the code. These terms
        govern the hosted service we run.
      </p>
      <p>
        We work to keep the service available and secure, but we don’t promise it will be uninterrupted or that a feature will stay the same. We may change,
        add or remove features. If we remove something significant you rely on, we will try to tell you in advance and give you a way to export your data.
      </p>

      <h2 id="account">3. Your account</h2>
      <ul>
        <li>Give accurate information, and keep your email address current: it is how we reach you about your account.</li>
        <li>
          Keep your password, recovery codes and tokens secret. You are responsible for what happens under your account, including what apps and tokens you
          authorise do. Tell us at {L('securityContact')} if you think someone else has access.
        </li>
        <li>An account is for one person. Don’t share it, sell it or create accounts to get around limits or a suspension.</li>
      </ul>

      <h2 id="content">4. Your content</h2>
      <p>
        You keep all rights in what you put on Freero: boards, docs, comments, files and anything else (“your content”). You give us a worldwide,
        non-exclusive, royalty-free licence to host, store, copy, process, transmit and display your content only as needed to run the service for you and the
        people you share it with: for example to sync it in real time, show it to collaborators, index it for your searches, back it up, render previews and
        exports, and send it to the services you choose to use (an AI provider, an issue tracker, a connected app). The licence ends when your content is
        deleted, except for copies in backups until they expire and content others still have a right to (such as comments on their boards).
      </p>
      <p>
        You are responsible for your content and for having the rights to share it. Who can see a board is up to its owner and its workspace’s settings:
        if you turn on link sharing, anyone with the link can open the board as the link allows.
      </p>
      <p>
        If you send us suggestions or feedback, we may use them without any obligation to you.
      </p>

      <h2 id="ai">5. AI features and connected apps</h2>
      <ul>
        <li>
          AI actions and AI assistants can be wrong. Check what they produce before you rely on it. AI suggestions are previewed, and changes an assistant
          proposes wait for a person to accept them, but you are responsible for what you add to your boards.
        </li>
        <li>
          When you connect an app or assistant (for example Claude or ChatGPT), you authorise it to act for you within the permissions you grant. What it does
          through that connection counts as done by you. You can disconnect it at any time. The app or assistant is provided by someone else under their own
          terms; we are not responsible for it.
        </li>
        <li>
          AI model providers process the content of AI actions under their own terms (see the <a href="/privacy#ai">privacy policy</a>). Don’t send content to
          AI features that you are not allowed to share with such a provider.
        </li>
        <li>Don’t use the API, the MCP server or agents to get around rate limits, permissions or these terms.</li>
      </ul>

      <h2 id="rules">6. Rules and moderation</h2>
      <p>
        Follow the <a href="/acceptable-use">acceptable use policy</a>. Anyone who can open a board can report it, an item on it, a file or a comment. We
        review reports and may, where content or behaviour breaks these terms or the law: turn off a board’s link, take a board down for review, remove a
        file, or suspend an account. We tell the person affected what we did and why, and how to appeal; appeals are reviewed by a person. In urgent cases
        (for example to stop illegal content or protect someone’s safety) we may act first and explain after. Reports can also be sent to{' '}
        {L('abuseContact')}, including notices that content infringes your copyright or other rights.
      </p>

      <h2 id="third">7. Other services</h2>
      <p>
        The service lets you use other services: sign-in providers, issue trackers (Jira, Linear, GitHub), video and design embeds, call links, AI providers
        and connected apps. Your use of them is governed by their terms. We are not responsible for them, and a change on their side may change what works
        here.
      </p>

      <h2 id="fees">8. Price</h2>
      <p>
        The service is currently free. If we ever introduce paid plans, we will tell you in advance; you will not be charged for anything without agreeing to
        it first.
      </p>

      <h2 id="ending">9. Ending the agreement</h2>
      <p>
        You can stop using the service and delete your account at any time (Account settings → Delete account); it is recoverable for{' '}
        {L('deletionGraceDays')} days, then deleted. Before you go you can download your data. We may suspend or end your access if you seriously or
        repeatedly break these terms, if the law requires it, or if continuing would put the service or others at risk. Unless the situation is urgent or the
        law prevents it, we will tell you first and give you a chance to export your data. If we ever shut the service down, we will give at least 30 days’
        notice. Sections 4 (the part about backups), 10, 11, 12 and 14 survive the end of the agreement.
      </p>

      <h2 id="warranty">10. Disclaimers</h2>
      <p>
        The service is provided “as is” and “as available”. To the extent the law allows, we disclaim all warranties, express or implied, including
        merchantability, fitness for a particular purpose and non-infringement. Keep your own copies of anything you can’t afford to lose: you can export
        boards and your data at any time.
      </p>

      <h2 id="liability">11. Limits on liability</h2>
      <p>
        To the extent the law allows, we are not liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue or
        data, and our total liability for any claim about the service is limited to the greater of the amount you paid us in the 12 months before the claim and
        US$100. Nothing in these terms limits liability that can’t be limited by law, such as for fraud, or for death or personal injury caused by
        negligence.
      </p>
      <p>
        If you use the service for an organization, you will defend and indemnify us against third-party claims arising from your content or your breach of
        these terms.
      </p>
      <p>
        If you are a consumer, you keep the rights the law of the country you live in gives you, and nothing in these terms takes them away.
      </p>

      <h2 id="law">12. Governing law and disputes</h2>
      <p>
        These terms are governed by the laws of {L('jurisdiction')}, without regard to conflict-of-law rules. Before going to court, please write to{' '}
        {L('contact')} so we can try to resolve the issue. If you are a consumer, you may also bring proceedings in the courts where you live, and mandatory
        consumer protections of your country apply.
      </p>

      <h2 id="changes">13. Changes to these terms</h2>
      <p>
        We may update these terms. For changes that matter, we will tell you by email or in the app at least 30 days before they take effect, unless the change
        is required by law or fixes a security issue sooner. If you don’t agree, you can delete your account before then; continuing to use the service after
        the change means you accept it.
      </p>

      <h2 id="general">14. General</h2>
      <p>
        These terms, the acceptable use policy and the privacy policy are the whole agreement between you and us about the service. If a part is found
        unenforceable, the rest stays in effect. If we don’t enforce a right, we haven’t given it up. You may not transfer this agreement without our consent;
        we may transfer it to a successor operating the service, and will tell you. Questions: {L('contact')}.
      </p>
    </LegalArticle>
  ),
});

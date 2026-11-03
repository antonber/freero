// DRAFT FOR LEGAL REVIEW, and under review until the operator approves it (`underReview: true`). Written
// for this service from what it does (the security overview, the subprocessor list, the privacy
// policy's data map) by someone who is not a lawyer; it is not legal advice and copies no other
// company's agreement. The parties' facts are `L(...)` tokens (modules/site/legal.ts); commitments
// the operator still has to make are marked <ToConfirm />.
import { definePage } from '../lib/define';
import { L, LegalArticle, ToConfirm } from '../lib/legal';
import { abs } from '../lib/site';

const UPDATED = '2026-11-03';

export default definePage({
  path: '/dpa',
  name: 'Data processing addendum',
  title: 'Data processing addendum (DPA) · Freero',
  description: 'The data processing addendum for organizations using the hosted Freero service: GDPR and UK GDPR Article 28 terms with the standard contractual clauses.',
  updated: UPDATED,
  underReview: true,
  legal: true,
  closingCta: false,
  body: () => (
    <LegalArticle
      title="Data processing addendum"
      updated={UPDATED}
      intro={
        <>
          <p>
            This data processing addendum (“DPA”) applies when an organization uses the Freero service at <a href={abs('/')}>{abs('/')}</a> and, in doing so,
            has {L('operator')} (“we”, “us”) process personal data for it. It adds to the <a href="/terms">terms of service</a> (the “Agreement”) the terms
            that Article 28 of the GDPR and of the UK GDPR require, and the safeguards for transferring personal data out of the EEA, the UK and Switzerland.
          </p>
          <p>
            <strong>How to sign it:</strong> fill in your organization’s details in the signature block at the end, sign, and send it to {L('contact')}. It
            takes effect when we countersign and send it back <ToConfirm />. To keep a copy, print this page or save it as a PDF from your browser.
          </p>
        </>
      }
      toc={[
        ['definitions', 'Definitions'],
        ['roles', 'Roles and scope'],
        ['instructions', 'Processing on your instructions'],
        ['personnel', 'Our people'],
        ['security', 'Security'],
        ['subprocessors', 'Subprocessors'],
        ['requests', 'Requests from individuals'],
        ['incidents', 'Personal data breaches'],
        ['assistance', 'Impact assessments and consultations'],
        ['deletion', 'Return and deletion'],
        ['audits', 'Information and audits'],
        ['transfers', 'International transfers'],
        ['ccpa', 'US state privacy laws'],
        ['general', 'Liability, term and precedence'],
        ['annex1', 'Annex I: parties and the processing'],
        ['annex2', 'Annex II: security measures'],
        ['annex3', 'Annex III: subprocessors'],
        ['sign', 'Signatures'],
      ]}
    >
      <h2 id="definitions">1. Definitions</h2>
      <ul>
        <li>
          <strong>“Customer”</strong>, “you”: the organization that signs this DPA and uses the service through one or more team workspaces.
        </li>
        <li>
          <strong>“Customer Personal Data”</strong>: personal data in the content and records of your team workspaces that we process for you to provide the
          service: boards, docs, comments, files, members and their roles, invitations, the workspace audit log, and the accounts of the people you bring into
          those workspaces as far as the workspaces use them.
        </li>
        <li>
          <strong>“Data Protection Law”</strong>: the laws on personal data that apply to the processing under the Agreement, including the EU General Data
          Protection Regulation 2016/679 (“GDPR”), the GDPR as it forms part of UK law with the Data Protection Act 2018 (“UK GDPR”), the Swiss Federal Act
          on Data Protection (“FADP”), and US state privacy laws such as the California Consumer Privacy Act (“CCPA”).
        </li>
        <li>
          <strong>“Subprocessor”</strong>: a company we engage to process Customer Personal Data.
        </li>
        <li>
          <strong>“Personal Data Breach”</strong>: a breach of security leading to the accidental or unlawful destruction, loss, alteration, unauthorised
          disclosure of, or access to, Customer Personal Data that we process.
        </li>
        <li>
          <strong>“SCCs”</strong>: the standard contractual clauses for the transfer of personal data to third countries adopted by the European
          Commission in Implementing Decision (EU) 2021/914 of 4 June 2021. <strong>“UK Addendum”</strong>: the International Data Transfer Addendum to the
          EU Commission Standard Contractual Clauses issued by the UK Information Commissioner under section 119A of the Data Protection Act 2018 (version B1.0,
          in force 21 March 2022).
        </li>
        <li>Controller, processor, data subject, personal data, processing and supervisory authority have the meanings the GDPR gives them.</li>
      </ul>

      <h2 id="roles">2. Roles and scope</h2>
      <p>
        You are the controller of Customer Personal Data (or a processor acting for your own controller, in which case we are your subprocessor and you pass
        on to that controller what this DPA gives you). We are your processor. Annex I describes the processing: its subject matter, nature, purpose and
        duration, and the kinds of data and data subjects.
      </p>
      <p>
        We are a controller, not your processor, of the personal data we need to run and protect the service itself, as the{' '}
        <a href="/privacy">privacy policy</a> describes: account sign-in and security records, request logs, abuse reports and moderation, problem reports
        people send us, analytics where a visitor accepts it, and what the law requires us to keep. We use that data only for those purposes.
      </p>
      <p>
        You are responsible for having a lawful basis for the processing you ask of us, for the instructions you give, and for what your workspaces contain.
        The service is not designed for special categories of personal data (Article 9 GDPR), data about criminal convictions, payment card data or health
        records, and you will not use it for them unless we agree in writing.
      </p>

      <h2 id="instructions">3. Processing on your instructions</h2>
      <p>
        We process Customer Personal Data only on your documented instructions, including for transfers to a third country, unless the law we are subject to
        requires otherwise; then we tell you before processing, unless that law forbids it. Your instructions are the Agreement, this DPA, and what you and
        your workspace’s admins do in the service: the content you add, the settings you choose (sharing, retention, single sign-on, provisioning, AI and
        integrations) and the apps, trackers and webhooks you connect. We tell you if we think an instruction infringes Data Protection Law. We don’t sell
        Customer Personal Data, use it for advertising, or use it to train AI models.
      </p>

      <h2 id="personnel">4. Our people</h2>
      <p>
        Only people who need access to provide, support or secure the service may access Customer Personal Data, and only as far as they need it. Each of them
        is bound by confidentiality <ToConfirm />. Today the service is run by a very small team; who has administrative access is listed in our records and
        available to you on request <ToConfirm />.
      </p>

      <h2 id="security">5. Security</h2>
      <p>
        We implement the technical and organisational measures in Annex II, which take into account the state of the art, the cost of implementation, and the
        nature, scope, context and purposes of the processing and the risks to individuals (Article 32 GDPR). The <a href="/security">security overview</a>{' '}
        describes them in more detail. We may change them, but not in a way that lowers the overall protection of Customer Personal Data.
      </p>

      <h2 id="subprocessors">6. Subprocessors</h2>
      <ul>
        <li>
          You give us general written authorisation to engage Subprocessors. The current ones are on the <a href="/subprocessors">subprocessor page</a>{' '}
          (Annex III).
        </li>
        <li>
          We tell you about any intended addition or replacement at least 30 days before it starts processing Customer Personal Data, by updating that page and
          emailing the owners of your team workspaces <ToConfirm />. In an emergency (to keep the service running or secure) the notice may be shorter, and we
          explain why.
        </li>
        <li>
          You may object, on reasonable grounds relating to data protection, within that notice period by writing to {L('contact')}. We then discuss it with
          you in good faith. If we can’t resolve it, you may end the Agreement for the affected workspaces before the change takes effect.
        </li>
        <li>
          We put each Subprocessor under a written contract with data protection obligations no less protective than this DPA, as far as they fit the service it
          provides, and we remain responsible to you for its performance of them.
        </li>
      </ul>

      <h2 id="requests">7. Requests from individuals</h2>
      <p>
        Most requests can be handled by your admins in the service itself: admins can see members, export a whole workspace, remove people and content, set
        retention, and read the audit log; each person can export or delete their own account. Where that isn’t enough, we help you, taking into account the
        nature of the processing, to answer requests to exercise data subjects’ rights. If a request about Customer Personal Data reaches us directly, we
        pass it to you without undue delay and don’t answer it ourselves except to say it was passed on, unless the law requires otherwise.
      </p>

      <h2 id="incidents">8. Personal data breaches</h2>
      <p>
        We notify you without undue delay, and in any case within 72 hours <ToConfirm />, after becoming aware of a Personal Data Breach. We send the notice to
        the owners of the affected team workspaces and to any security contact you give us. It describes, as far as we know them at the time: the nature of
        the breach, the categories and approximate number of data subjects and records concerned, the likely consequences, the measures taken or proposed,
        and a contact for more information. We add what we learn later, take reasonable steps to contain the breach and limit its effects, and help you meet
        your own obligations to notify authorities and individuals. Notifying you is not an admission of fault.
      </p>

      <h2 id="assistance">9. Impact assessments and consultations</h2>
      <p>
        We give you the information you reasonably need, about the processing we do for you, for data protection impact assessments and prior consultations
        with a supervisory authority (Articles 35 and 36 GDPR). The security overview, this DPA and the service’s public source code and documentation are
        the first part of that information.
      </p>

      <h2 id="deletion">10. Return and deletion</h2>
      <ul>
        <li>
          While the Agreement runs, your admins can export a workspace at any time (admin console → Data → Export workspace) and delete boards and whole
          workspaces. Deleting a workspace takes effect at once.
        </li>
        <li>
          When the Agreement ends, you have 30 days to export Customer Personal Data <ToConfirm />. After that, or sooner on your written request, we delete it
          from the live service. Copies in database backups are deleted when those backups expire, at most {L('backupRetentionDays')} days later, and are not
          used meanwhile except to restore the service.
        </li>
        <li>
          The audit log of a deleted workspace is kept, as a security record, until its retention period ends, unless the law requires us to keep data longer;
          then this DPA keeps applying to what we keep.
        </li>
      </ul>

      <h2 id="audits">11. Information and audits</h2>
      <p>
        We make available the information needed to demonstrate compliance with Article 28 GDPR: this DPA, the security overview, the subprocessor list,
        written answers to reasonable security questionnaires, and the service’s source code, which is public. We do not hold third-party certifications (such
        as SOC 2 or ISO 27001) yet.
      </p>
      <p>
        If that information is not enough, or a supervisory authority requires it, you may audit our compliance with this DPA, yourself or through an
        independent auditor bound by confidentiality, no more than once a year, with at least 30 days’ written notice, during business hours and without
        disturbing the service or other customers’ data <ToConfirm />. You bear the cost of your audit. Audits of our Subprocessors are carried out by means
        of their own published reports and certifications.
      </p>

      <h2 id="transfers">12. International transfers</h2>
      <p>
        We are established in the United States <ToConfirm />, and the service is hosted there ({L('hosting')}). Where Customer Personal Data is transferred to us from the EEA,
        Switzerland or the UK and no adequacy decision covers the transfer, the following apply and are incorporated into this DPA by reference:
      </p>
      <ul>
        <li>
          <strong>EEA:</strong> the SCCs, <strong>Module Two</strong> (controller to processor) where you are a controller, and <strong>Module Three</strong>{' '}
          (processor to processor) where you are a processor. For those modules: clause 7 (docking clause) applies; under clause 9, option 2 (general written
          authorisation) applies, with the notice period in section 6 of this DPA; the optional wording in clause 11 does not apply; under clause 13, the
          competent supervisory authority is that of the EU Member State where you are established or, if you are not established in the EU, where your
          representative is, or as Annex I says; under clause 17, option 1, the SCCs are governed by the law of Ireland <ToConfirm />; under clause 18, disputes
          go to the courts of Ireland <ToConfirm />. Annexes I, II and III of this DPA are the SCCs’ Annexes I, II and III.
        </li>
        <li>
          <strong>UK:</strong> the SCCs as amended by the UK Addendum. Its Table 1 is completed by Annex I, Table 2 by the choices above, Table 3 by Annexes I to
          III, and in Table 4 either party may end the UK Addendum as its section 19 allows.
        </li>
        <li>
          <strong>Switzerland:</strong> the SCCs as above, adapted so that references to the GDPR include the FADP, the competent supervisory authority is the
          Swiss Federal Data Protection and Information Commissioner for transfers under the FADP, and the term “Member State” does not prevent data subjects
          in Switzerland from suing for their rights where they live.
        </li>
      </ul>
      <p>
        We are not certified under the EU-U.S. Data Privacy Framework <ToConfirm />. If the transfer mechanism above is invalidated or replaced, we work with you
        to put an alternative lawful mechanism in place. If we receive a request from a public authority for Customer Personal Data, we review it for
        legality, tell you unless the law forbids it, and disclose only the minimum the request lawfully requires.
      </p>

      <h2 id="ccpa">13. US state privacy laws</h2>
      <p>
        Where the CCPA or a similar US state law applies, we are your service provider (or processor) for Customer Personal Data. We process it only for the
        business purposes in the Agreement; don’t sell or share it (as the CCPA defines those words); don’t retain, use or disclose it outside our direct
        business relationship with you or for any purpose other than providing the service; don’t combine it with personal data we get from others except as
        the law permits; comply with the law and give it the protection the law requires; and tell you if we can no longer meet these obligations. You may take
        reasonable steps to stop and remedy unauthorised use.
      </p>

      <h2 id="general">14. Liability, term and precedence</h2>
      <ul>
        <li>
          Each party’s liability under this DPA is subject to the limits in the Agreement, except where Data Protection Law or the SCCs do not allow such a
          limit (for example, liability to data subjects under clause 12 of the SCCs).
        </li>
        <li>This DPA lasts as long as we process Customer Personal Data for you, including after the Agreement ends until the data is deleted.</li>
        <li>
          If they conflict, the SCCs (with the UK Addendum where it applies) prevail over this DPA, and this DPA prevails over the Agreement for the processing
          of Customer Personal Data.
        </li>
        <li>
          Apart from the SCCs, which are governed as section 12 says, this DPA is governed by the law that governs the Agreement ({L('jurisdiction')}).
        </li>
        <li>
          We may update this DPA to reflect changes in Data Protection Law or in the service, with at least 30 days’ notice. A change that reduces your
          protection needs your agreement.
        </li>
      </ul>

      <h2 id="annex1">Annex I: parties and the processing</h2>
      <h3>A. Parties</h3>
      <ul>
        <li>
          <strong>Data exporter</strong> (controller, or processor under Module Three): the Customer, as named in the signature block. Contact person: as
          given there. Activities relevant to the transfer: using the hosted Freero service.
        </li>
        <li>
          <strong>Data importer</strong> (processor): {L('operator')}, {L('postalAddress')}. Contact: {L('contact')}; security contact:{' '}
          {L('securityContact')}. Activities relevant to the transfer: providing the hosted Freero service.
        </li>
      </ul>
      <h3>B. Description of the processing and transfer</h3>
      <ul>
        <li>
          <strong>Data subjects:</strong> the Customer’s members, guests and other people it invites into its workspaces; people mentioned or shown in the
          content they add (on boards, in docs, comments, files and recordings).
        </li>
        <li>
          <strong>Categories of personal data:</strong> names, email addresses, profile pictures and cursor colours; roles and memberships; content the
          Customer’s people create or upload (text, drawings, images, PDFs, other files, voice and video in walkthrough recordings); comments, votes and
          answers in live activities; identifiers from the Customer’s identity provider and directory (SSO subject, SCIM records); security and audit records
          (sign-ins, sessions with IP address and browser, the actions recorded in the workspace’s audit log, calls made by connected apps); usage counts.
        </li>
        <li>
          <strong>Sensitive data:</strong> none intended (section 2). The restrictions and safeguards that apply are those in Annex II.
        </li>
        <li>
          <strong>Frequency:</strong> continuous, for as long as the Customer uses the service.
        </li>
        <li>
          <strong>Nature of the processing:</strong> hosting, storage, real-time synchronisation and display to the people the Customer lets in, search
          indexing, version history, exports and backups, sending notification emails, and the integrations the Customer turns on (AI actions, issue trackers,
          webhooks, connected apps).
        </li>
        <li>
          <strong>Purpose:</strong> providing the service to the Customer under the Agreement.
        </li>
        <li>
          <strong>Retention:</strong> for the term of the Agreement and then as section 10 says. Inside the service, the Customer’s retention settings apply
          (trash, version history, audit log), and backups expire within {L('backupRetentionDays')} days.
        </li>
        <li>
          <strong>Transfers to Subprocessors:</strong> as listed on the <a href="/subprocessors">subprocessor page</a>, for the purposes listed there and for
          the duration of the Agreement.
        </li>
      </ul>
      <h3>C. Competent supervisory authority</h3>
      <p>
        As clause 13 of the SCCs and section 12 of this DPA say; if the Customer has no establishment or representative in the EU, the authority named by the
        Customer in the signature block <ToConfirm />. For the UK, the Information Commissioner’s Office; for Switzerland, the Federal Data Protection and
        Information Commissioner.
      </p>

      <h2 id="annex2">Annex II: security measures</h2>
      <p>
        A summary; the <a href="/security">security overview</a> has the detail, and the source code shows exactly how each is done.
      </p>
      <ul>
        <li>
          <strong>Encryption in transit:</strong> HTTPS only, with HSTS; secure, HttpOnly session cookies; TLS to the email service; encrypted connections
          to the database and the object storage <ToConfirm />.
        </li>
        <li>
          <strong>Encryption at rest:</strong> passwords stored as scrypt hashes and tokens as SHA-256 hashes; secrets such as two-step verification keys,
          single sign-on client secrets, AI keys and integration credentials sealed with AES-256-GCM under a rotatable key; storage encryption of the
          database and files by the hosting provider <ToConfirm />.
        </li>
        <li>
          <strong>Access control:</strong> every request and live connection is checked on the server against the person’s role on the board and the
          workspace’s policies; workspaces can require two-step verification, enforce single sign-on, provision and deprovision through SCIM, and limit
          session length and idle time; administrative access to the production systems is limited to the operator’s staff who need it <ToConfirm />.
        </li>
        <li>
          <strong>Separation of customers:</strong> one shared database with every read and write checked against the requester’s access; content the server
          withholds (private drafts, hidden frames) never reaches people, apps or indexes that may not see it.
        </li>
        <li>
          <strong>Logging and audit:</strong> an append-only, hash-chained audit log per workspace with signed hourly checkpoints, an integrity check, export,
          and streaming to the Customer’s SIEM; request logs without request bodies, query strings, cookies or tokens.
        </li>
        <li>
          <strong>Availability and recovery:</strong> automated database backups kept up to {L('backupRetentionDays')} days, health-checked rolling deploys,
          restart on failure; restore tests <ToConfirm />.
        </li>
        <li>
          <strong>Secure development:</strong> automated type checks, architecture checks and tests on every change, a container smoke test before deploys,
          public source code, and a published vulnerability disclosure policy.
        </li>
        <li>
          <strong>Incidents:</strong> a documented response procedure and the notification commitment in section 8.
        </li>
      </ul>

      <h2 id="annex3">Annex III: subprocessors</h2>
      <p>
        The list on the <a href="/subprocessors">subprocessor page</a>, as it stands when the DPA is signed and as updated under section 6.
      </p>

      <h2 id="sign">Signatures</h2>
      <p>Signed by the authorised representatives of the parties.</p>
      <div className="table-wrap legal-sign" tabIndex={0} role="region" aria-label="Signature block">
        <table>
          <caption>Signature block</caption>
          <thead>
            <tr>
              <th scope="col"> </th>
              <th scope="col">Customer (data exporter)</th>
              <th scope="col">{L('operator')} (data importer)</th>
            </tr>
          </thead>
          <tbody>
            {['Legal name and address', 'Contact for data protection', 'Signed by (name, title)', 'Signature', 'Date'].map((row) => (
              <tr key={row}>
                <th scope="row">{row}</th>
                <td> </td>
                <td> </td>
              </tr>
            ))}
            <tr>
              <th scope="row">Supervisory authority, if not established in the EU</th>
              <td> </td>
              <td>—</td>
            </tr>
          </tbody>
        </table>
      </div>
    </LegalArticle>
  ),
});

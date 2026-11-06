// "Is there a free whiteboard with SSO and SCIM?" (seo.md: free Miro alternative with SSO, whiteboard
// sso scim). Competitor cells come from the published /vs pages' rows; the setup steps are the
// integrations catalog's own connect steps (@freero/shared), so they read as the app does.
import { integrationById } from '@freero/shared';
import { defineAnswer } from '../../lib/answers';
import { APP } from '../../lib/site';
import { integrationPath } from '../../lib/integrations';
import { comparison as confluence } from '../vs/confluence-whiteboards.page';
import { comparison as excalidraw } from '../vs/excalidraw.page';
import { comparison as figjam } from '../vs/figjam.page';
import { comparison as microsoftWhiteboard } from '../vs/microsoft-whiteboard.page';
import { comparison as miro } from '../vs/miro.page';
import { comparison as mural } from '../vs/mural.page';

const steps = (id: string) => {
  const i = integrationById(id);
  if (!i) throw new Error(`no integration ${id}`);
  return i.connect.steps;
};
const [verifyDomain, connectIdp] = steps('saml-sso');
const [scimToken, scimDirectory] = steps('scim');

export default defineAnswer({
  slug: 'free-whiteboard-with-sso',
  name: 'Free whiteboard with SSO',
  question: 'Is there a free whiteboard with SSO and SCIM?',
  title: 'Free whiteboard with SSO, SCIM and audit log | Freero',
  description:
    'Yes: Freero is a free, open-source whiteboard with SAML or OpenID Connect SSO, SCIM and an audit log in every team workspace. No paid plan, no seats.',
  updated: '2026-11-06',
  answer:
    'Yes. Freero is a free, open-source (MIT) online whiteboard that includes SAML or OpenID Connect single sign-on, SCIM provisioning and an audit log in every team workspace, with no paid plan and no seat count. It is also built for AI agents: Claude, ChatGPT and other assistants connect over MCP and propose changes that people accept.',
  facts: [
    'Single sign-on per team workspace: verify your domain with a DNS TXT record, then connect a SAML 2.0 or OpenID Connect identity provider.',
    'Owners can enforce SSO for the domain; that also refuses API tokens and apps made without it. A break-glass owner keeps a password sign-in in case the identity provider breaks.',
    'SCIM 2.0 with a token per workspace: directories such as Okta and Microsoft Entra add people, map groups to roles or projects and deactivate leavers, which closes the workspace’s boards to them at once.',
    'An append-only, hash-chained audit log per workspace, exportable as CSV or JSON and streamed to Splunk, Microsoft Sentinel, an HTTPS collector or syslog. Every API and MCP call by an agent is in it.',
    'No plan unlocks any of this: the hosted service and every self-hosted server include it, and there is no licence fee.',
  ],
  matrix: {
    title: 'Single sign-on, SCIM and audit log, compared',
    lead: 'Where each whiteboard puts these features. “Paid plans” means they exist, on a paid tier or add-on.',
    caption: 'Single sign-on, SCIM and audit log by product',
    columns: ['Single sign-on', 'SCIM provisioning', 'Audit log'],
    rows: [
      { product: miro, cells: ['SAML single sign-on', 'SCIM provisioning', 'Audit log'] },
      { product: mural, cells: ['SAML single sign-on', 'SCIM provisioning', 'Audit log'] },
      { product: figjam, cells: ['SAML single sign-on', 'SCIM provisioning', 'Audit log'] },
      { product: confluence, cells: ['SSO, SCIM and audit log', 'SSO, SCIM and audit log', 'SSO, SCIM and audit log'] },
      { product: microsoftWhiteboard, cells: ['Single sign-on', null, 'Audit trail'] },
      { product: excalidraw, cells: ['SSO and SCIM', 'SSO and SCIM', null] },
    ],
    freero: [
      { verdict: 'yes', note: 'SAML 2.0 or OpenID Connect per workspace, free', ref: 'docs/operations.md' },
      { verdict: 'yes', note: 'SCIM 2.0, groups mapped to roles or projects', ref: 'docs/operations.md' },
      { verdict: 'yes', note: 'per workspace, hash-chained, exportable and streamed to your SIEM', ref: 'docs/configuration.md' },
    ],
  },
  steps: {
    title: 'How to set up SSO and SCIM in Freero',
    lead: 'An owner or admin of a team workspace does this in its admin console; on a self-hosted server the operator only needs PUBLIC_URL set.',
    items: [
      {
        title: 'Create a team workspace',
        body: (
          <>
            <a href={APP.signup}>Sign up free</a> and create a team workspace from your boards page. Its owners and admins get an admin console.
          </>
        ),
      },
      { title: 'Verify your domain', body: verifyDomain },
      { title: 'Connect your identity provider', body: <>{connectIdp} OpenID Connect takes an issuer, a client id and a secret instead of metadata.</> },
      { title: 'Turn on provisioning', body: `${scimToken} ${scimDirectory}` },
    ],
  },
  related: [
    ['/security', 'Security overview: SSO, SCIM, the audit log and encryption'],
    [integrationPath('saml-sso'), 'SAML single sign-on'],
    [integrationPath('oidc-sso'), 'OpenID Connect single sign-on'],
    [integrationPath('scim'), 'SCIM provisioning'],
    ['/pricing', 'Pricing: no paid plans'],
    ['/vs/miro', 'Freero vs Miro'],
    ['/open-source', 'Self-host Freero behind your own identity provider'],
  ],
  faq: [
    {
      q: 'Is single sign-on really free in Freero?',
      a: 'Yes. Freero has no paid plans, so SAML and OpenID Connect single sign-on, SCIM provisioning, the audit log and the admin console are part of every team workspace, on the hosted service and on every self-hosted server. There is no add-on to buy and no seat count.',
    },
    {
      q: 'Which identity providers work with Freero?',
      a: 'Any identity provider that speaks SAML 2.0 or OpenID Connect can sign people in at your verified domain. For provisioning, Freero serves SCIM 2.0, which directories such as Okta and Microsoft Entra use to add people, map groups and deactivate leavers.',
    },
    {
      q: 'Can I require SSO for everyone at my company?',
      a: 'Yes. Once your domain is verified, an owner can enforce SSO: sign-ins at that domain go to your identity provider, and API tokens and apps created without SSO are refused. The owner chosen as break-glass account keeps a password sign-in in case the identity provider breaks.',
    },
    {
      q: 'Do AI agents get around SSO?',
      a: 'No. An agent connected over MCP acts for one person, with that person’s access and only the permissions granted to the connection. When SSO is enforced, tokens and apps made without it are refused, a workspace can block apps entirely, and every agent call is in the audit log.',
    },
  ],
});

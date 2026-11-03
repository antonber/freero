# Security questionnaire answers (hosted freero.app)

Prepared answers for common vendor-security questionnaires (the topics of a CAIQ-lite), for the
hosted service operated by Kaiten Gaming LLC. Each answer cites where it is shown in this repository
or, for facts the repository can't show, whether they come from the operator (approved by its owner
on 2026-11-03) or from a provider's own documentation. The one answer still marked **TO CONFIRM**
is a fact only the owner can give; leave it out of anything sent until then.
Customers who self-host answer for their own deployment (start with
[deployment.md](deployment.md#encryption-at-rest)).

Public pages: [security overview](https://freero.app/security),
[subprocessors](https://freero.app/subprocessors), [DPA](https://freero.app/dpa),
[privacy policy](https://freero.app/privacy), [SECURITY.md](../SECURITY.md).

## Organisation and compliance

| Question | Answer | Source |
|---|---|---|
| Who provides the service? | Kaiten Gaming LLC operates the hosted service; the software is MIT-licensed open source. Postal address: 5900 Balcones Drive Ste 100, Austin, TX 78731, United States. | site legal pages (`SITE_LEGAL_OPERATOR`, `SITE_LEGAL_ADDRESS`) |
| Certifications (SOC 2, ISO 27001, HIPAA, PCI DSS)? | None. No third-party attestation yet (#110). | docs/parity.md §12 |
| Penetration test? | None yet. | — |
| Information security policy and a named security owner? | The owner of Kaiten Gaming LLC owns security (reachable at security@freero.app). The written policies are the security overview, SECURITY.md and the operations guide; there is no separate certified ISMS. | operator; /security, SECURITY.md, docs/operations.md |
| Staff background checks, confidentiality agreements, security training? | The service is run by its owner alone, with no other staff. Anyone given access to Customer Personal Data is bound by confidentiality (DPA section 4); the list of who has administrative access is available on request. No formal background-check or training programme. | operator; /dpa section 4 |
| DPA available? | Yes, GDPR / UK GDPR Article 28 with the 2021 SCCs (Modules Two and Three; clauses 17 and 18: Ireland) and the UK Addendum: /dpa, signed by countersignature through support@freero.app. Not certified under the EU-U.S. Data Privacy Framework. | apps/site/src/pages/dpa.page.tsx |
| Subprocessors? | Listed with purpose, data and location at /subprocessors (Railway, with Tigris Data behind Railway's buckets; Resend; Google; Porkbun; Anthropic); config-driven rows update with the deployment; at least 30 days' notice of additions, emailed to team-workspace owners. | apps/site/src/pages/subprocessors.page.tsx |
| Cyber insurance? | **TO CONFIRM** (the owner hasn't stated it). | — |

## Hosting and architecture

| Question | Answer | Source |
|---|---|---|
| Where is data hosted? | Railway Corporation, United States, US West (`us-west2`), one instance; Railway-managed PostgreSQL (point-in-time recovery); a Railway Storage Bucket for files, which Railway runs on Tigris Data's servers, in US West, California (`sjc`). No Redis. | .railway/railway.ts, /privacy as served, Railway docs (storage buckets, `railway bucket`) |
| Can customers choose a region? | No (one region). Self-hosting runs anywhere. | docs/parity.md (data residency) |
| Multi-tenant? | Yes, logical separation: one database; every HTTP, WebSocket, API and MCP access goes through one server-side permission check. | ARCHITECTURE.md "Suite foundation: … one permission check" |
| High availability / DR? | One instance, one region, restart on failure, health-checked deploys; no standby region, no SLA. | .railway/railway.ts, docs/deployment.md |

## Encryption and keys

| Question | Answer | Source |
|---|---|---|
| Encryption in transit? | TLS everywhere public (HTTP→HTTPS 301, HSTS 1 year incl. subdomains, Let's Encrypt certificates at Railway's edge); SMTP over implicit TLS (port 465). App→database over Railway's private network (`postgres.railway.internal`), which Railway encrypts with WireGuard; app→bucket over HTTPS (`https://t3.storageapi.dev`; Railway buckets are reachable only over public networking). | live headers; docs/deployment.md "TLS and the reverse proxy"; Railway docs (private networking, enterprise security) |
| Encryption at rest? | Railway documents AES-256 encryption at rest for all data it stores, in every region: volumes (the database), volume backups, point-in-time recovery archives, storage buckets and environment variables (envelope-encrypted), with keys Railway manages. Credentials hashed (scrypt for passwords, SHA-256 for tokens); secrets sealed by the app with AES-256-GCM. Board content is not app-encrypted (reasoning in the source). | docs/deployment.md "Encryption at rest", docs/operations.md "Encryption baseline"; Railway docs (enterprise security, storage buckets) |
| Key management / KMS? | One app secret (`SESSION_SECRET`) in Railway's variables, HKDF per purpose, rotatable with zero downtime. No customer-managed keys on the hosted service; self-hosters can use AWS KMS for the bucket (`S3_SSE=aws:kms`). | docs/operations.md "Rotating SESSION_SECRET" |

## Identity and access

| Question | Answer | Source |
|---|---|---|
| SSO? | SAML 2.0 and OpenID Connect per team workspace, verified domains, enforceable with a break-glass owner. IdP-initiated SAML off by default, per-workspace switch (Destination check, replay cache, same-origin RelayState). No single logout or encrypted assertions yet (#13). | docs/operations.md "Workspace single sign-on", ARCHITECTURE.md "Enterprise identity" |
| Domain control? | Per verified domain: capture existing accounts (emailed first, opt out by changing address), auto-join new sign-ups, block other team workspaces. Self-hosters can also run invite-only (`SIGNUPS=invite-only`). | ARCHITECTURE.md "Domain control", docs/configuration.md |
| SCIM? | SCIM 2.0 users and groups; deprovisioning ends access and sessions. | same |
| MFA? | TOTP with recovery codes; workspaces can require it for everyone opening their boards. | ARCHITECTURE.md "Audit log, admin console and workspace policies" |
| Session management? | Default 30 days; per-workspace maximum (1 h–90 d) and idle timeout (15 min–30 d); session list and revoke; new-device emails. | `WORKSPACE_SETTING_LIMITS` in packages/shared/src/api.ts |
| Password policy? | Minimum 8 characters, scrypt, rate-limited sign-in, uniform timing for unknown addresses. | apps/server/src/modules/auth/service.ts |
| Role-based access? | Boards: owner, editor, commenter, viewer. Workspaces: owner, admin, member, guest. Enforced server-side. | packages/shared/src/api.ts |
| Operator / admin access to production? | Operators are the verified addresses in `OPERATOR_EMAILS` (config, not database). No impersonation feature; content is seen only through reports and problem reports. One person, the owner of Kaiten Gaming LLC, holds the Railway, GitHub and Porkbun (domain and DNS) accounts; two-step verification is required on each. Changes to the hosted service's code and configuration are made only by the operator. | docs/operations.md "Who is an operator"; operator |

## Logging, monitoring and audit

| Question | Answer | Source |
|---|---|---|
| Audit log? | Append-only (DB trigger), SHA-256 hash chain per workspace, hourly signed checkpoints of chain heads, integrity check, CSV/JSON export with hashes, 365-day default retention (30–3,650). | ARCHITECTURE.md "Audit log" |
| SIEM integration? | Push streams per workspace: Splunk HEC, Microsoft Sentinel (Logs Ingestion API), signed HTTPS collector, syslog over TLS; ordered, at least once, with hashes and hourly signed heads. Pull: `GET /api/v1/workspaces/{id}/audit` (`audit:read`). | docs/operations.md "Audit log streams (SIEM)" |
| Application logs? | Structured JSON, no bodies, query strings, cookies or tokens; kept by Railway up to 90 days (`SITE_LEGAL_LOG_DAYS`, the upper bound: Railway documents 7 days on Hobby, 30 on Pro, up to 90 on Enterprise). | docs/operations.md "Logs"; Railway docs (logs) |
| Monitoring and alerting? | `/healthz`, `/readyz` (Railway's health check: a deploy takes traffic only once it passes), Prometheus metrics; the image is smoke-tested in CI before deploys and the live service after them (`scripts/smoke-test.sh`); problem reports triaged every weekday. No automated alerting or paging yet. Error tracking: none configured. | .railway/railway.ts, .github/workflows/docker.yml, docs/operations.md "Monitoring" |

## Backups, retention and deletion

| Question | Answer | Source |
|---|---|---|
| Backups? | Railway PostgreSQL backups, daily (6 days) and weekly (27 days) with point-in-time recovery; at most 30 days (`SITE_LEGAL_BACKUP_DAYS`). | docs/marketing/directory-submissions.md |
| Restore tested? | At least once a quarter (procedure in docs/operations.md "Restore"). | operator |
| File versioning? | No: Railway buckets don't support object versioning, so a deleted file keeps no earlier copy. Files nothing uses are deleted within a day. | Railway docs (storage buckets) |
| Data retention and deletion? | Per data type in the privacy policy's retention table; account deletion after a 14-day grace; workspace deletion immediate; backups expire within 30 days. | docs/operations.md "Data map" |
| Data export? | Personal and whole-workspace exports (ZIP) at any time. | docs/operations.md "Exports" |

## Secure development and vulnerabilities

| Question | Answer | Source |
|---|---|---|
| SDLC? | Every change runs architecture-boundary checks, type checks, tests and a real-session verification in GitHub Actions; the image is built and smoke-tested before deploys. | .github/workflows/check.yml, docker.yml |
| Dependency scanning / SAST? | None automated yet (no Dependabot or CodeQL); dependency licences are checked. | .github/, scripts/license-check.mjs |
| Vulnerability disclosure? | security@freero.app, security.txt, SECURITY.md (acknowledge in 3 business days, updates every 14 days, 90-day coordinated disclosure, safe harbour for good-faith research, credit, no paid bounty). | SECURITY.md |
| Web protections? | CSP, CSRF origin checks, upload sniffing and sandbox CSP, SSRF-safe outbound requests, rate limits. | docs/configuration.md "Security behaviour" |

## Incidents

| Question | Answer | Source |
|---|---|---|
| Incident response plan? | Documented basics: assess, mitigate, recover, write-up with a follow-up check. | docs/operations.md "Incident basics" |
| Breach notification? | Customers without undue delay, and within 72 hours, under the DPA. | /dpa section 8 |

## AI

| Question | Answer | Source |
|---|---|---|
| Is customer data used to train models? | No. | docs/ai.md |
| Which AI providers receive data? | For product AI features, none on the hosted service today (AI is off). When configured: only the prompt and the content the person can see, not stored by Freero, audited without text. | docs/ai.md "What happens to your data" |
| Third-party assistants (Claude, ChatGPT)? | Only when a person connects one, with scoped OAuth; read and suggest by default; every call audited. | docs/mcp.md |
| AI used in operations? | Yes: a scheduled Claude Code task (Anthropic, PBC) triages "Report a problem" submissions on weekdays through the operator API, with a token limited to problem reports (`problems:triage`); it files sanitised issues (no reporter data, board content or screenshots) in the public repository. Under Anthropic's commercial terms, Anthropic may not train models on that content. | docs/api/README.md (problems:triage), /subprocessors |

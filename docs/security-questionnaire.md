# Security questionnaire answers (hosted freero.app)

**Draft — under review.** Prepared answers for common vendor-security questionnaires (the topics of
a CAIQ-lite), for the hosted service operated by Kaiten Gaming LLC. Each answer cites where it is
shown in this repository. Answers marked **TO CONFIRM** are facts about the operator or its
providers the repository can't show; the owner confirms or corrects them before any is sent.
Customers who self-host answer for their own deployment (start with
[deployment.md](deployment.md#encryption-at-rest)).

Public pages: [security overview](https://freero.app/security),
[subprocessors](https://freero.app/subprocessors), [DPA](https://freero.app/dpa),
[privacy policy](https://freero.app/privacy), [SECURITY.md](../SECURITY.md).

## Organisation and compliance

| Question | Answer | Source |
|---|---|---|
| Who provides the service? | Kaiten Gaming LLC operates the hosted service; the software is MIT-licensed open source. Postal address: **TO CONFIRM**. | site legal pages (`SITE_LEGAL_OPERATOR`) |
| Certifications (SOC 2, ISO 27001, HIPAA, PCI DSS)? | None. No third-party attestation yet (#110). | docs/parity.md §12 |
| Penetration test? | None yet. | — |
| Information security policy and a named security owner? | **TO CONFIRM** (the owner of Kaiten Gaming LLC). | — |
| Staff background checks, confidentiality agreements, security training? | **TO CONFIRM**. | — |
| DPA available? | Yes, GDPR / UK GDPR Article 28 with the 2021 SCCs (Modules Two and Three) and the UK Addendum: /dpa (draft). | apps/site/src/pages/dpa.page.tsx |
| Subprocessors? | Listed with purpose, data and location at /subprocessors; config-driven rows update with the deployment. | apps/site/src/pages/subprocessors.page.tsx |
| Cyber insurance? | **TO CONFIRM**. | — |

## Hosting and architecture

| Question | Answer | Source |
|---|---|---|
| Where is data hosted? | Railway Corporation, United States, US West (`us-west2`), one instance; Railway-managed PostgreSQL; a Railway storage bucket for files (its underlying provider and region: **TO CONFIRM**). | .railway/railway.ts, /privacy as served |
| Can customers choose a region? | No (one region). Self-hosting runs anywhere. | docs/parity.md (data residency) |
| Multi-tenant? | Yes, logical separation: one database; every HTTP, WebSocket, API and MCP access goes through one server-side permission check. | ARCHITECTURE.md "Suite foundation: … one permission check" |
| High availability / DR? | One instance, one region, restart on failure, health-checked deploys; no standby region, no SLA. | .railway/railway.ts, docs/deployment.md |

## Encryption and keys

| Question | Answer | Source |
|---|---|---|
| Encryption in transit? | TLS everywhere public (HTTP→HTTPS 301, HSTS 1 year incl. subdomains, Let's Encrypt certificates at Railway's edge); SMTP over implicit TLS (port 465). App↔database and app↔bucket on Railway's network: **TO CONFIRM** whether encrypted. | live headers; docs/deployment.md "TLS and the reverse proxy" |
| Encryption at rest? | Database and bucket storage encryption by Railway: **TO CONFIRM**. Credentials hashed (scrypt for passwords, SHA-256 for tokens); secrets sealed by the app with AES-256-GCM. Board content is not app-encrypted (reasoning in the source). | docs/deployment.md "Encryption at rest", docs/operations.md "Encryption baseline" |
| Key management / KMS? | One app secret (`SESSION_SECRET`) in Railway's variables, HKDF per purpose, rotatable with zero downtime. No customer-managed keys on the hosted service; self-hosters can use AWS KMS for the bucket (`S3_SSE=aws:kms`). | docs/operations.md "Rotating SESSION_SECRET" |

## Identity and access

| Question | Answer | Source |
|---|---|---|
| SSO? | SAML 2.0 and OpenID Connect per team workspace, verified domains, SP-initiated only, enforceable with a break-glass owner. | docs/operations.md "Workspace single sign-on", ARCHITECTURE.md "Enterprise identity" |
| SCIM? | SCIM 2.0 users and groups; deprovisioning ends access and sessions. | same |
| MFA? | TOTP with recovery codes; workspaces can require it for everyone opening their boards. | ARCHITECTURE.md "Audit log, admin console and workspace policies" |
| Session management? | Default 30 days; per-workspace maximum (1 h–90 d) and idle timeout (15 min–30 d); session list and revoke; new-device emails. | `WORKSPACE_SETTING_LIMITS` in packages/shared/src/api.ts |
| Password policy? | Minimum 8 characters, scrypt, rate-limited sign-in, uniform timing for unknown addresses. | apps/server/src/modules/auth/service.ts |
| Role-based access? | Boards: owner, editor, commenter, viewer. Workspaces: owner, admin, member, guest. Enforced server-side. | packages/shared/src/api.ts |
| Operator / admin access to production? | Operators are the verified addresses in `OPERATOR_EMAILS` (config, not database). No impersonation feature; content is seen only through reports and problem reports. Who holds Railway, GitHub and DNS accounts, and their MFA: **TO CONFIRM**. | docs/operations.md "Who is an operator" |

## Logging, monitoring and audit

| Question | Answer | Source |
|---|---|---|
| Audit log? | Append-only (DB trigger), SHA-256 hash chain per workspace, integrity check, CSV/JSON export with hashes, 365-day default retention (30–3,650). | ARCHITECTURE.md "Audit log" |
| SIEM integration? | Not yet (#17); export, or workspace webhooks for board events. | docs/parity.md |
| Application logs? | Structured JSON, no bodies, query strings, cookies or tokens; kept by Railway up to 90 days (`SITE_LEGAL_LOG_DAYS`; Railway's actual retention: **TO CONFIRM**). | docs/operations.md "Logs" |
| Monitoring and alerting? | `/healthz`, `/readyz`, Prometheus metrics; alerting on the hosted service: **TO CONFIRM**. Error tracking: none configured. | docs/operations.md "Monitoring" |

## Backups, retention and deletion

| Question | Answer | Source |
|---|---|---|
| Backups? | Railway PostgreSQL backups, daily (6 days) and weekly (27 days) with point-in-time recovery; at most 30 days (`SITE_LEGAL_BACKUP_DAYS`). | docs/marketing/directory-submissions.md |
| Restore tested? | **TO CONFIRM** (procedure in docs/operations.md "Restore"). | — |
| File versioning? | Bucket versioning on the hosted bucket: **TO CONFIRM**. | — |
| Data retention and deletion? | Per data type in the privacy policy's retention table; account deletion after a 14-day grace; workspace deletion immediate; backups expire within 30 days. | docs/operations.md "Data map" |
| Data export? | Personal and whole-workspace exports (ZIP) at any time. | docs/operations.md "Exports" |

## Secure development and vulnerabilities

| Question | Answer | Source |
|---|---|---|
| SDLC? | Every change runs architecture-boundary checks, type checks, tests and a real-session verification in GitHub Actions; the image is built and smoke-tested before deploys. | .github/workflows/check.yml, docker.yml |
| Dependency scanning / SAST? | None automated yet (no Dependabot or CodeQL); dependency licences are checked. | .github/, scripts/license-check.mjs |
| Vulnerability disclosure? | security@freero.app, security.txt, SECURITY.md (acknowledge in 3 business days, 90-day coordinated disclosure; **TO CONFIRM**). | SECURITY.md |
| Web protections? | CSP, CSRF origin checks, upload sniffing and sandbox CSP, SSRF-safe outbound requests, rate limits. | docs/configuration.md "Security behaviour" |

## Incidents

| Question | Answer | Source |
|---|---|---|
| Incident response plan? | Documented basics: assess, mitigate, recover, write-up with a follow-up check. | docs/operations.md "Incident basics" |
| Breach notification? | Customers without undue delay, within 72 hours under the DPA (**TO CONFIRM**). | /dpa section 8 |

## AI

| Question | Answer | Source |
|---|---|---|
| Is customer data used to train models? | No. | docs/ai.md |
| Which AI providers receive data? | None on the hosted service today (AI is off). When configured: only the prompt and the content the person can see, not stored by Freero, audited without text. | docs/ai.md "What happens to your data" |
| Third-party assistants (Claude, ChatGPT)? | Only when a person connects one, with scoped OAuth; read and suggest by default; every call audited. | docs/mcp.md |
| AI used in operations? | An automated assistant triages "Report a problem" submissions through the operator API (provider and terms: **TO CONFIRM**). | docs/api/README.md (problems:triage) |

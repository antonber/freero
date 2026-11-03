# Organisations above team workspaces (#108)

Status: **built** (steps 1–5 below). Granular admin roles (#151), the board inventory (#152) and
org-wide templates (#155) build on this later.

## What we want

A company with many teams has ONE organisation. IT sets up single sign-on, provisioning, verified
domains, baseline policies and audit streaming once; every team workspace attached to the
organisation inherits them. Organisation admins see all of the organisation's workspaces and one
merged audit trail, and manage the settings — but they get no board content unless someone gives
them an ordinary grant (a workspace membership, a board invite).

Today each team workspace repeats all of it: `modules/sso` (domains, IdP, domain control),
`modules/scim`, `WorkspacePolicies` / `WorkspaceSettings`, `modules/audit` (one hash chain per
workspace) and `modules/siem`. A 40-team company configures SSO 40 times.

## Model

**An organisation is a directory-only row of `workspaces`, `kind = 'organisation'`.** Team
workspaces point at it with `workspaces.organisation_id` (a column, so a workspace belongs to at
most one organisation; only `kind = 'team'` rows may have one, checked by the database).

```
workspaces (kind 'organisation')      the organisation: name, policy floors, security floors
  workspace_members                   its directory: owners and admins (who run it) and members
                                      (people its SSO, SCIM or domain control brought in)
  sso_domains / sso_connections /     its single sign-on, verified domains, domain control,
  sso_domain_policies / scim_* /      provisioning and SIEM streams — the SAME tables and code a
  siem_sinks / audit chain w:<id>     team workspace uses, keyed by the organisation's id
workspaces (kind 'team', organisation_id = the organisation)
```

Why a row of `workspaces` and not a new table: everything that makes up "a directory" in Freero —
DNS-proved domains, the SAML / OIDC connection with its replay cache and flows, IdP-initiated
sign-in, domain capture, SCIM tokens / users / groups, SIEM sinks with their cursors, the audit
chain and its signed checkpoints, member deactivation — is keyed by a workspace id and checks its
caller with `requireWorkspace(…, 'admin')`. Keying the organisation the same way reuses all of that
security-critical code unchanged instead of growing a second copy or a "directory owner" union
through every table. The price is containment: an organisation must never behave like a workspace
where boards live. That is enforced in one place, `modules/workspaces`, and fails closed:

- `requireWorkspace` / `requireWorkspaceRole` answer 404 for an organisation unless the caller
  opts in (`{ organisation: true }`). Only the directory features opt in: SSO, provisioning,
  SIEM, the audit log, members and settings of the admin console. Invites, projects, boards,
  webhooks, AI, API settings, trackers and exports keep refusing it.
- `admin.requireAdmin` takes the same opt-in.
- A board can't be created in an organisation (`lockWorkspaceForNewBoard`), so it holds no boards,
  projects or content; `workspacesOf` / `rolesOf` (dashboards, lists, search, the public API's
  workspace list, board access) never return organisation rows; every `kind = 'team'` query
  (quotas, session policies, account-event fan-out) already leaves them out.

The API names it as what it is: `GET/POST /api/organisations`, `OrganisationSummary` in
`@freero/shared`. The identity, audit and admin-console endpoints of a workspace
(`/api/workspaces/:id/sso`, `/scim`, `/admin/siem`, `/audit`, `/admin/members`, `/admin/settings`,
`PATCH /workspaces/:id` for name and policies) also answer for an organisation under its own id.

### Roles

- **Organisation owner / admin** (`workspace_members` of the organisation row): manage the
  organisation's settings, identity, audit and streams; list its workspaces with their members and
  owners; detach a workspace; deactivate a person organisation-wide. Owners also add or remove
  admins, transfer and delete the organisation. Same rank rules as a workspace (`mayChangeRole`,
  `mayRemove`, last owner kept).
- **Organisation member**: someone in its directory (signed in through its SSO, provisioned by its
  SCIM, captured at its domain). Grants nothing by itself: what they open comes from the team
  workspaces they are in.
- Org roles give **no board access**: board access is resolved from the board's OWN workspace
  membership only (`rolesOf` excludes organisation rows; `boardAccessLoader` reads the board's
  workspace). An org admin who is also a member of a workspace has exactly that membership there.

## Single writers

| Durable value | Single writer | How others change it |
|---|---|---|
| The organisation row, its directory (`workspace_members` of it), its policy and security floors | `modules/workspaces` (`organisations.ts`, `repo.ts`) | `/api/organisations…`; `PATCH /workspaces/:orgId` (name, policy floors), `PATCH /workspaces/:orgId/admin/settings` (security floors) |
| A workspace's organisation (`workspaces.organisation_id`, `organisation_attached_at`) | `modules/workspaces` (`attachWorkspace` / `detachWorkspace`; the account purge's `handOverOrganisation`) | `POST /organisations/:id/workspaces`, `DELETE /organisations/:id/workspaces/:workspaceId` |
| Memberships an organisation's SCIM groups grant in its workspaces | `modules/workspaces` (`setDirectoryWorkspaceMembership`, `removeMemberByDirectory`) | `modules/scim` `syncPerson` |
| The organisation's SSO, domains, domain control | `modules/sso` (unchanged tables, keyed by the organisation id) | its routes, opted in for organisations |
| The organisation's provisioning, incl. groups mapped to a workspace | `modules/scim` (`scim_groups.mapping_workspace_id`, new) | `PUT /workspaces/:orgId/scim/groups/:groupId` |
| The organisation's audit chain `w:<orgId>` | `modules/audit` (fan-out from every attached workspace's events) | `recordAudit` as today |
| The organisation's SIEM streams | `modules/siem` | its routes, opted in for organisations |

## Inheritance rules

**Policies and security settings are floors.** An attached workspace gets the stricter of its own
value and the organisation's, per key, computed in ONE place (`workspaces/repo.ts` reads every
workspace with its organisation and `roles.ts` `strictestPolicies` / `strictestSettings` combine
them). Every reader — `boardAccessLoader`, `teamMembers`, `mayDownload`, `mayShareExternally`, the
embed and guest checks — only ever sees the effective values, so a floor is enforced wherever the
policy is.

| Key | Order, loosest → strictest |
|---|---|
| `externalSharing` | anyone → admins → none |
| `linkSharing` | editor → commenter → viewer → none |
| `guestInvites` | members → admins |
| `downloads` | anyone → members → admins |
| `publicLinks` | anyone → signedIn |
| `liveEmbeds`, `boardEmbeds` | on → off |
| `linkPassword` | optional → required |
| `linkMaxDays` | none → more days → fewer days (the shorter limit) |
| `requireTwoFactor` | off → on |
| `sessionMaxHours`, `sessionIdleMinutes` | none → longer → shorter (the smaller limit) |

- A board moved into an attached workspace (#124) is adjusted to the target's EFFECTIVE policies
  (its link lowered or turned off, embedding off), since the move reads the target through the same
  joined read; an organisation is never a move target (`lockWorkspaceForNewBoard`).
- An organisation is created with the LOOSEST value of every key, which means "no floor": attaching
  a workspace changes nothing until the organisation tightens something.
- **A workspace may tighten, never loosen.** `PATCH /workspaces/:id` and `PATCH …/admin/settings`
  refuse (403, `organisation_policy`, naming the organisation) a value looser than the floor. A
  workspace's own stored value is kept; if the organisation later relaxes its floor, the
  workspace's own (stricter) choice applies again.
- Session limits keep their one model ("a session belongs to the person"): the strictest limit of
  every team workspace a person is a member of, each one already raised to its organisation's
  floor, and of the organisations whose directory they are in.
- Not inherited, on purpose: `teamAccess` (how open a team is to its own members; projects
  override it per project, so a floor would need to cap project levels and buys no security),
  trash and version retention (a team's own data housekeeping) and audit retention (each chain has
  its own; the organisation's chain keeps the organisation's).
- Deactivation: a person deactivated in the organisation's directory (an admin, or the
  organisation's SCIM deprovisioning) opens nothing in ANY attached workspace — the same `blocked`
  rule `resolveRole` honours first, checked for the board's workspace and its organisation.

**Identity.** The organisation's SSO, domains, domain control and SCIM are defined once on the
organisation and used by all its workspaces:

- A verified domain still has exactly one holder (`sso_domains_verified_key`). Sign-ins for its
  addresses route to the holder's IdP; when the holder is the organisation, that is every attached
  workspace's people at the domain. "Enforce SSO" on the organisation refuses every other way in for
  those addresses and ends their non-SSO sessions — whichever attached workspace they work in.
- An SSO newcomer joins the organisation's directory (the connection's default role there; owners
  and admins only by an owner); team membership is given by workspace admins or by SCIM groups.
- SCIM on the organisation provisions accounts at its verified domains into its directory. A group
  maps to a role in the organisation (admin or member, as a workspace's groups map a role) or — new
  — to **membership of an attached workspace with a role** (`{ kind: 'workspace', workspaceId, role }`):
  members of the group get at least that role there (highest mapped role wins; never lowered;
  owners are never changed); leaving the group, or the group's mapping moving away, removes them
  unless another of their groups still grants the workspace, their boards there passing to an
  owner as with any removal. (Project mappings stay a workspace's own SCIM feature.)
  Deprovisioning deactivates them in the directory, so in every attached workspace at once,
  without removing anyone.
- A workspace that set up its own SSO / domains / SCIM before attaching keeps them, unchanged
  (its IdP is configured with that workspace's own SAML entity ID and ACS URL; moving them would
  break the IdP's configuration and lock people out). Its admins can retire them once the
  organisation's are in place. A domain moves only by being removed from one and verified by the
  other.

**Audit.** Every event recorded for an attached workspace goes to that workspace's chain `w:<ws>`
exactly as before AND to the organisation's chain `w:<org>`, in the same transaction
(`recordAudit` asks workspaces which organisation each workspace belongs to — `setOrganisationScope`,
the same kind of seam as the account fan-out). Each chain is numbered and hash-linked on its own,
so each still verifies on its own (`audit:verify <id>` / the console's Integrity). Rows keep the
workspace the event happened in (`audit_events.workspace_id`); a log is read by its chain. An
account's own events reach the organisation once, however many of its workspaces the person is in.
The organisation's SIEM streams read its chain like a workspace's.

## Attaching and detaching

- **Create**: any account may create an organisation (it becomes its owner), subject to domain
  control's "Block other team workspaces" like a team workspace, and to
  `MAX_ORGANISATIONS_PER_USER` (3).
- **People**: owners add an existing account as admin, admins add members
  (`POST /organisations/:id/members`, like a workspace adds an existing account); roles change and
  people leave through the workspace member routes under the organisation's id. Deactivating
  someone there is organisation-wide.
- **Attach** (`POST /api/organisations/:id/workspaces { workspaceId }`): the caller must be an
  OWNER of the team workspace AND an owner or admin of the organisation, both checked under the two
  rows' locks in one transaction. A workspace already in another organisation is refused (detach
  first). Audited `organisation.workspace_attached` in both chains. Board access is re-resolved on
  every instance at once (floors may tighten).
- A workspace admin who is not its owner can't attach it; nobody can attach a workspace to an
  organisation they don't administer. (Proof of ownership is administering both sides: a verified
  domain proves who the organisation's PEOPLE are and is what its SSO, SCIM and domain capture need,
  but it never moves a team's boards.)
- **Detach** (`DELETE /api/organisations/:id/workspaces/:wsId`): an organisation owner or admin.
  The workspace's own owner can't detach it alone — otherwise detaching would be a way around the
  floors. Audited `organisation.workspace_detached` in both chains (recorded before the link goes,
  so it reaches the organisation's log). The workspace's own settings apply again at once.
- **Delete** an organisation: an owner, typing its name, only once no workspace is attached. Its
  SSO, SCIM and SIEM settings go with it (foreign keys); its audit chain ages out with the default
  retention.

## Migration

Additive, no backfill. One migration in `modules/workspaces` widens the `kind` check, adds
`organisation_id` (FK to `workspaces` with no delete action — an organisation is deleted only once
nothing is attached — indexed) and `organisation_attached_at`, and checks that only team rows have an
organisation and that both columns are set together. `modules/scim` adds
`scim_groups.mapping_workspace_id` and the `workspace` mapping kind. `modules/audit` adds an index
`(chain, id DESC)`: logs are now read by chain, which for every existing row is the same set as
reading by `workspace_id` (each `w:<id>` row carries `workspace_id = <id>`). Existing workspaces,
with or without SSO, stay standalone and behave exactly as before; an organisation is optional.

## Rollout

- Deploy the server first (the migration is additive; the new code reads old rows unchanged).
- During a rolling deploy, an instance still on the previous release doesn't know organisations: it
  would list an organisation row among its admins' workspaces and wouldn't stop a board being
  created in one. Nobody should create an organisation until every instance runs the new release
  (organisations only exist once someone creates one, so there is nothing to undo).
- Web clients of the previous release ignore the new `WorkspaceSummary.organisation` field.

## Steps

1. `server/workspaces`: the model, containment, floors, attach / detach, organisation routes.
2. `server/audit`: fan-out to the organisation's chain, reading logs by chain.
3. `server/sso`, `server/scim`, `server/siem`, `server/admin`: opt in for organisations; SCIM
   groups mapped to workspaces; organisation-wide deactivation.
4. `web`: the organisation console (`/org/:id`: workspaces, members, security floors, single
   sign-on, provisioning, audit log with streams), "Organisation" on a workspace's admin overview
   (create / attach / see what it inherits), floors shown and looser choices disabled in a
   workspace's Security tab, a dashboard link for organisation admins.
5. Docs (ARCHITECTURE, configuration, operations) and the real-app check.

## Security tests (what must never break)

- A workspace admin (not owner), or an owner who doesn't administer the organisation, can't attach
  the workspace to it.
- A policy the organisation sets can't be loosened per workspace, neither by a request nor by a
  stored value older than the floor.
- The organisation's "Enforce SSO" refuses password sign-in for the people at its domain in every
  attached workspace.
- An attached workspace's events stay in its own chain (which verifies on its own) and also reach
  the organisation's chain (which verifies on its own).
- An organisation admin gets no board content of an attached workspace without an ordinary grant.

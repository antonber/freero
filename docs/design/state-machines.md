# State machines

Every explicit and implicit state machine in Freero: its states, the invariants that must hold,
and its transitions, with the code that performs each one. Written from the state-machine audit of
2026-11-06 and kept current as fixes land: when you add a state, a transition or a guard, update
the machine here in the same change.

Conventions: `from → to | trigger | guard | where`. "Confirmed" findings were reproduced by a
failing test or traced line by line; "Suspected" ones are plausible but not proven. Fixed findings
name the regression test that guards them.

## Findings register

| ID | Finding | Evidence | Impact | Tracked in | Fix |
|---|---|---|---|---|---|
| ID-1 | Directory provisioning hands a company's workspace to whoever squatted the employee's address | Confirmed | High | [GHSA-r52x-62gm-fqxw](https://github.com/antonber/freero/security/advisories/GHSA-r52x-62gm-fqxw) | fixed: auth/providers.test.ts "a workspace's directory (provisioning or single sign-on) never takes over an account whose address was never verified with what its creator set up" |
| DATA-2 | Export jobs that crash their instance are retried forever (privacy and eDiscovery) | Confirmed | Medium–High | [#186](https://github.com/antonber/freero/issues/186) | fixed: privacy/exportJobs.test.ts, ediscovery/exportJobs.test.ts "… fails after three attempts and no longer blocks a new one" |
| ID-2 | A retried or concurrent refresh with the same refresh token disconnects the app (and the winning refresh fails with a 500) | Confirmed | Medium | [GHSA-jr6r-fv35-w6p8](https://github.com/antonber/freero/security/advisories/GHSA-jr6r-fv35-w6p8) | fixed: apiauth.test.ts "an app's own refreshes sent at once with the same refresh token (parallel calls, or a retry after a lost response) keep it connected" and "… a refresh token replayed after the app moved on, or after the retry window, ends the app's access" |
| ID-3 | Re-consenting an app with fewer permissions doesn't take them away from tokens it already holds | Confirmed | Medium | [GHSA-jr6r-fv35-w6p8](https://github.com/antonber/freero/security/advisories/GHSA-jr6r-fv35-w6p8) | fixed: apiauth.test.ts "reconnecting an app with less (fewer permissions, another resource) takes the rest away from the tokens and codes it already holds" |
| ID-4 | Two owners deactivating each other at once leaves the workspace with no active owner (unrecoverable without an operator) | Confirmed | Medium | [GHSA-wpr8-2wp8-v938](https://github.com/antonber/freero/security/advisories/GHSA-wpr8-2wp8-v938) | fixed: workspaces/membershipGuards.test.ts "a workspace keeps an active owner when its two owners deactivate each other at the same moment" (+ transfer to a deactivated member refused; last-owner leave answers 409, not a crash) |
| ID-6 | An email change someone else started survives the password reset the notice tells the owner to do | Confirmed | Medium | [GHSA-r52x-62gm-fqxw](https://github.com/antonber/freero/security/advisories/GHSA-r52x-62gm-fqxw) | fixed: auth/emails.test.ts "an email change someone else started can not be confirmed once the owner reset (or changed) the password" |
| DATA-1 | A board its owner restored from the trash is trashed again by the next retention round | Confirmed | Medium | [#187](https://github.com/antonber/freero/issues/187) | fixed: boards/retention.test.ts "a board its owner restored after a trash rule removed it is not trashed again until it is idle for the period again …" |
| DATA-3 | An export archive is left in storage forever when the build fails after the file is written | Confirmed | Medium | [#186](https://github.com/antonber/freero/issues/186) | fixed: same files, "… archive stored by a build that never became ready is deleted from storage once its export fails" |
| DATA-5 | Destroying a workspace key can shred content a legal hold placed concurrently keeps | Confirmed | Medium | [#188](https://github.com/antonber/freero/issues/188) | fixed: keys/destroyUnderHold.test.ts "a legal hold placed while the owner is destroying the workspace key stops the destroy, and the held board stays readable" |
| RT-1 | A socket admitted while access is ending joins with the role it had (removal, trash, takedown) | Confirmed | Medium | [GHSA-g744-qqqx-fvh8](https://github.com/antonber/freero/security/advisories/GHSA-g744-qqqx-fvh8) | fixed: realtime/accessRevocation.test.ts "a member removed while their socket is being admitted is not let in with the role they had" and "a board trashed while a socket is being admitted does not let that socket into a fresh room" |
| RT-2 | Access revocation is one-shot: a refresh that fails, or a lost control message, leaves a removed member connected | Confirmed | Medium | [GHSA-g744-qqqx-fvh8](https://github.com/antonber/freero/security/advisories/GHSA-g744-qqqx-fvh8) | fixed: accessRevocation.test.ts "a removed member's open socket is closed even when the access refresh hits a database error once" and "… even when this instance never heard of the removal" |
| RT-4 | Undo after a collaborator overwrote my last edit takes back half of an earlier two-doc action, and the dragged sticky disappears for everyone | Confirmed | Medium | [#198](https://github.com/antonber/freero/issues/198) | fixed: engine/__tests__/undoAcrossRemote.test.ts "undo after a collaborator overwrote my last edit never deletes the sticky I dragged out of a hidden frame before it" (+ redo and cancel variants) |
| RT-5 | A server close after the upgrade (1009 too large, 4429 too many connections, 1011 load failed) puts the client in a ~100 ms reconnect loop | Confirmed | Medium | [#199](https://github.com/antonber/freero/issues/199) | fixed: engine/__tests__/reconnect.test.ts (quick server closes are retried less and less often; 1009 stops reconnecting, says why and forgets the device copy) |
| RT-7 | A Redis outage on one instance's publishing side leaves the other instances' copies behind for the room's lifetime | Confirmed | Medium | [#199](https://github.com/antonber/freero/issues/199) | fixed: realtime/peerResync.test.ts "an instance whose publishes were lost for a while still gets the other copy of the board in step once it is back" |
| INT-1 | An endpoint that was deleted or turned off while the delivery job was running keeps receiving deliveries for the rest of that run | Confirmed | Medium | [#190](https://github.com/antonber/freero/issues/190) | fixed: webhooks.test.ts "a webhook an admin deleted / turned off while the delivery job is sending to it gets nothing more from that run" |
| INT-2 | Unlinking an issue (or removing its connection) while that link's sync is in flight leaves a ghost badge and `trackerLink` marks on the board for a link that no longer exists | Confirmed | Medium | [#191](https://github.com/antonber/freero/issues/191) | fixed: trackers/links.test.ts "an issue unlinked while its sync is writing the board leaves no badge or link mark there" (+ unlinked while reading; connection removed while writing) |
| INT-3 | Sending the same items twice at once (a double submit, or an agent retrying `sync_to_tracker`) creates two issues in the tracker; the second is never linked | Confirmed | Medium | [#191](https://github.com/antonber/freero/issues/191) | fixed: trackers/links.test.ts "sending the same items twice at once (a double click, an agent retrying sync_to_tracker) creates one issue in the tracker, not an unlinked duplicate" |
| INT-4 | Advisory lock keys are not unique: the tracker poll job shares its key with the search index consumer, and three other pairs collide, so each pair blocks and skips the other | Confirmed | Medium | [#189](https://github.com/antonber/freero/issues/189) | fixed: startup.test.ts "every module's background jobs and outbox consumers start together without two of them sharing an advisory lock key"; platform/jobs.test.ts "a job or consumer given a lock key another one already uses fails as it is registered, naming both" |
| INT-5 | Shutdown doesn't wait for a job run longer than its interval; the database is closed under it | Confirmed | Medium | [#189](https://github.com/antonber/freero/issues/189) | fixed: platform/jobs.test.ts "a shutdown during a job run longer than its interval waits for that run before the database closes" |
| INT-6 | Due tracker retries are claimed (their `retry_at` cleared) before the poll's tracker calls and only queued at the end, so a poll cut short loses them for good | Confirmed | Medium | [#189](https://github.com/antonber/freero/issues/189) | fixed: trackers/polling.test.ts "a failed sync whose retry a tracker poll took is still retried when that poll is cut short before it finishes" |
| INT-101 | One board that can't be loaded stops every digest email on the server | Confirmed | Medium | [#189](https://github.com/antonber/freero/issues/189) | fixed: notifications/digestJob.test.ts "one board that cannot be loaded for a due-date reminder does not stop every other person's digest email" |
| INT-201 | Connecting Slack while the last other person in that Slack workspace disconnects revokes the bot token the new link depends on | Confirmed | Medium | [#193](https://github.com/antonber/freero/issues/193) | fixed: slack/slack.test.ts "someone connecting Slack while the last other person in that Slack workspace disconnects is never left linked with a revoked token …" |
| INT-203 | Cancel in the Import dialog doesn't cancel: the Miro board (or file) is placed on the board after the dialog closed | Confirmed | Medium | [#193](https://github.com/antonber/freero/issues/193) | fixed: import/dialog.test.tsx (Miro and file-with-picture cancel cases); importers.test.ts "an import the person cancelled while Miro was still listing the board copies none of its pictures into their uploads" |
| FAC-1 | An ended session comes back when someone writes it at the same moment or offline (Stop, Finish retro, End round, Clear vote) | Confirmed | Medium | [#195](https://github.com/antonber/freero/issues/195) | fixed: timer.state.test.ts "a timer someone stopped does not come back paused …"; retro.test.tsx "a finished retro stays finished when a participant adds an action item at the same moment"; state tests for private mode, voting, estimation and facilitation; realtime/sessionEnds.test.ts (4 server guards) |
| FAC-2 | Regrouping a kanban while someone drags a card rewrites that card's field value (for example its Priority) | Confirmed | Medium | [#197](https://github.com/antonber/freero/issues/197) | fixed: kanban/kanban.state.test.ts "regrouping a board by Priority while someone drags cards to Done never rewrites a card's priority (set or not) nor loses its Stage …"; mcp/kanban.test.ts, trackers.test.ts and app/board/kanbanFields.test.ts for the stale-card writers |
| FAC-4 | The retro's vote step silently adopts a vote that was already running, then ends it | Confirmed | Medium | [#196](https://github.com/antonber/freero/issues/196) | fixed: app/board/retro.test.tsx (the vote step never adopts an open vote; moving on ends only the retro's own vote; a retro started during someone's private mode doesn't take it over) |
| FAC-5 | Card toolbar dates can put the start after the due date, and the card then refuses every API/MCP update | Confirmed | Medium | [#197](https://github.com/antonber/freero/issues/197) | fixed: card/details.test.tsx "the toolbar never stores a start after the due date …"; api/items.test.ts "a card stored with its start after its due date … can still be renamed and recoloured by update_items …" |
| FAC-6 | Leaving the board while recording a walkthrough keeps the microphone recording with no visible control, then auto-saves it to the board you left | Confirmed | Medium | [#194](https://github.com/antonber/freero/issues/194) | fixed: walkthrough/recorder.test.tsx "closing the board while recording turns the microphone off and keeps nothing" |
| FAC-8 | Ending a sealed vote (or revealing an estimate, or ending private mode) while not synced: the end reaches the server before the reveal, and is never followed by it if the tab closes | Confirmed | Medium | [#195](https://github.com/antonber/freero/issues/195) | fixed: engine/store/layerOpsOffline.test.ts "a sealed vote ended offline is revealed before the server reads it as ended, also when the tab was closed before reconnecting" |
| DATA-7 | The trash purge can delete a board restored while the purge waits on its row | Suspected | Medium | [#187](https://github.com/antonber/freero/issues/187) | fixed; confirmed and checked on real Postgres with two connections (no committed test: the test database has one connection) |
| ID-5 | A just-demoted owner or admin's in-flight request still runs with the old role | Confirmed | Low–Medium | [GHSA-wpr8-2wp8-v938](https://github.com/antonber/freero/security/advisories/GHSA-wpr8-2wp8-v938) | fixed: workspaces/membershipGuards.test.ts "an owner demoted a moment ago can no longer demote the other owners"; members/sharingGuards.test.ts "a co-owner demoted a moment ago can't make themselves co-owner again" |
| ID-7 | Invitations sent by an admin keep working after that admin is removed (or demoted) | Confirmed | Low–Medium | [GHSA-wpr8-2wp8-v938](https://github.com/antonber/freero/security/advisories/GHSA-wpr8-2wp8-v938) | fixed: membershipGuards.test.ts "the invitations an admin sent stop working once that admin is removed from the workspace" (+ demotion and resend cases); sharingGuards.test.ts "the invitations a co-owner sent stop working once they are removed from the board" |
| DATA-4 | A KEK-changing rotation can mark the workspace's key `unavailable` from a stale cache | Confirmed | Low–Medium | [#188](https://github.com/antonber/freero/issues/188) | fixed: keys/kms.test.ts "an instance still caching the key row from before another instance moved the key to a KMS key opens the board and never marks the key unavailable" |
| DATA-9 | Export archives are stored in the public storage area | Confirmed | Low–Medium | [#186](https://github.com/antonber/freero/issues/186) | fixed: uploads/privateFiles.test.ts "an export archive is never stored where the public URL serves files …" |
| RT-3 | One editor rejects while another accepts the same suggestion → the record says rejected and the change is on the board | Confirmed | Low–Medium | [#200](https://github.com/antonber/freero/issues/200) | fixed: realtime/suggestionRace.test.ts "an accept that reaches the server after a rejection of the same suggestion changes nothing on the board, live or sent from offline" (+ the reverse direction) |
| INT-102 | Simultaneous first reports of a target never alert the operators | Confirmed | Low–Medium | [#192](https://github.com/antonber/freero/issues/192) | fixed: moderation.test.ts "two people reporting a board at the same moment mail the operators exactly once, about its first report" |
| INT-103 | Mail queued with `sendMailLater` (moderation notices and appeal links, operator alerts) is lost on graceful shutdown | Confirmed | Low–Medium | [#189](https://github.com/antonber/freero/issues/189) | fixed: platform/mail.test.ts "a mail queued with sendMailLater just before a graceful shutdown … is sent before the server stops" (a crash still loses it: the queue is in memory) |
| INT-110 | A tracker OAuth token refresh in flight brings back credentials that "signed out everywhere" revoked | Confirmed | Low–Medium | [#191](https://github.com/antonber/freero/issues/191) | fixed: trackers/links.test.ts "an OAuth token refresh in flight when the owner is signed out everywhere does not bring the revoked credentials back" |
| FAC-3 | A double click on the retro's step button skips a step | Confirmed | Low–Medium | [#196](https://github.com/antonber/freero/issues/196) | fixed: app/board/retro.test.tsx "a double click on the step button moves the retro one step, not two" |
| FAC-9 | A client whose clock measurement failed writes deadlines in its own skewed clock for the life of the page | Confirmed | Low–Medium | [#196](https://github.com/antonber/freero/issues/196) | fixed: app/board/serverClock.test.ts "a page whose clock measurement failed (opened offline) measures again, and has no time for a deadline until it has" |
| DATA-6 | "Delete forever" racing a new hold answers 500 and reveals the hold | Confirmed | Low | [#187](https://github.com/antonber/freero/issues/187) | fixed: boards/legalHolds.test.ts "“delete forever” racing a legal hold placed after its check keeps the board as silently as an earlier hold" |
| DATA-8 | A board moved into a workspace without a key can keep rows sealed under the source's key, and no job repairs them | Confirmed | Low | [#188](https://github.com/antonber/freero/issues/188) | fixed: boards/keyedMove.test.ts "a save made during a move into a workspace without a key, left under the source's key when the reseal after the move failed, is opened by the background job …" |
| RT-6 | A person demoted below editor keeps (and keeps seeing) pending suggestions when the board has no hidden items | Confirmed | Low | [GHSA-g744-qqqx-fvh8](https://github.com/antonber/freero/security/advisories/GHSA-g744-qqqx-fvh8) | fixed: engine/__tests__/demotedSuggestions.test.ts "someone made a commenter no longer holds the pending suggestions of a board without hidden frames" |
| RT-8 | A request write that lands while its board is being trashed is reported as saved but lost | Confirmed | Low | [#200](https://github.com/antonber/freero/issues/200) | fixed: realtime/rooms.test.ts "an app's proposal that lands while its board is being moved to the trash is kept with the board, never reported made and lost" |
| RT-9 | Following someone stops for good after a blip in one's own connection | Confirmed | Low | [#199](https://github.com/antonber/freero/issues/199) | fixed: engine camera.test.ts "keeps following through a blip of your own connection, and lets go only if they are still gone once it is back" |
| INT-7 | A personal tracker connection whose credentials were revoked ("signed out everywhere") goes back to `active`, or to `error`, while it still has no credentials | Confirmed | Low | [#191](https://github.com/antonber/freero/issues/191) | fixed: trackers/links.test.ts "a personal connection signed out everywhere still says to connect it again after a sync that was in flight finishes and after a later sync" |
| INT-8 | A linked issue deleted in the tracker leaves its link retrying every 6 hours forever | Confirmed | Low | [#191](https://github.com/antonber/freero/issues/191) | fixed: trackers/links.test.ts "a linked issue deleted in the tracker stops being retried after a few tries, and its badge says it is gone" |
| INT-9 | A card imported from a tracker can lose its link: the link row is committed before its card exists, and a concurrent sync deletes "a link whose items are all gone" | Confirmed | Low | [#191](https://github.com/antonber/freero/issues/191) | fixed: trackers/links.test.ts "a card imported while a sync of the same board runs keeps its link …" |
| INT-10 | A tracker webhook registration that finishes after the connection switched to polling (or was removed) is marked `active`, and the tracker's webhook is never unregistered | Confirmed | Low | [#191](https://github.com/antonber/freero/issues/191) | fixed: trackers/links.test.ts "a webhook registration that finishes after the connection switched to polling is undone in the tracker, never left active" |
| INT-11 | The "webhook turned off" email promises that events which happen meanwhile are kept and sent again; they are never queued, and old pending ones are kept forever | Confirmed | Low | [#190](https://github.com/antonber/freero/issues/190) | fixed: webhooks.test.ts "deliveries waiting on a webhook that stays off are dropped with the 30-day delivery log, not kept forever" and the extended auto-disable test |
| INT-104 | An appeal against a file removal is accepted after the kept copy was purged, so it can never be granted | Confirmed | Low | [#192](https://github.com/antonber/freero/issues/192) | fixed: holds.test.ts "an appeal against a file removal is refused once the file's kept copy is deleted for good, since it could never be granted" |
| INT-105 | Problem screenshots can outlive their report or account when one file delete fails | Confirmed | Low | [#192](https://github.com/antonber/freero/issues/192) | fixed: problems.test.ts "a screenshot whose file delete fails is still deleted by the next retention run …" |
| INT-106 | A suspended account's community listings and templates stay public | Confirmed | Low | [#192](https://github.com/antonber/freero/issues/192) | fixed: marketplace.test.ts and gallery.test.ts "a suspended account's … is hidden … while it is suspended, and back as it was once lifted" |
| INT-202 | A Slack bot token outlives every link on paths other than Disconnect, so "forgotten when nobody is linked" holds on one path only | Confirmed | Low | [#193](https://github.com/antonber/freero/issues/193) | fixed: slack/slack.test.ts "the app’s token in a Slack workspace goes when its last link does, whichever way …" |
| FAC-7 | A recorder that fails to start stays in "starting" for the life of the tab, with the microphone open | Confirmed | Low | [#194](https://github.com/antonber/freero/issues/194) | fixed: walkthrough/recorder.test.tsx "when MediaRecorder throws/fires error on start, the microphone is given back" |
| ID-8 | A verified domain never expires or re-verifies | Suspected | Low | [#202](https://github.com/antonber/freero/issues/202) | open: needs a periodic re-check (enhancement) |
| ID-9 | Concurrent SCIM `active:false` and `active:true` for one person can leave the record active while the member stays deactivated | Suspected | Low | [GHSA-r52x-62gm-fqxw](https://github.com/antonber/freero/security/advisories/GHSA-r52x-62gm-fqxw) | fixed: scim/users.test.ts "a deprovisioning and a reactivation the directory sends at once never leave the person active in the directory but locked out of the workspace" |
| ID-10 | `markTested` is unconditional, so a sign-in validated against the old provider can mark a just-changed provider "tested" | Suspected | Low | [GHSA-r52x-62gm-fqxw](https://github.com/antonber/freero/security/advisories/GHSA-r52x-62gm-fqxw) | fixed: sso/idpInitiated.test.ts "a sign-in the previous identity provider answered does not count as proving the one an admin switched to meanwhile" |
| RT-10 | A proposal racing a revocation or another instance's room load loses its KAI-224 hint, so a revoked app's suggestions stay pending | Suspected | Low | [GHSA-g744-qqqx-fvh8](https://github.com/antonber/freero/security/advisories/GHSA-g744-qqqx-fvh8) | fixed (confirmed by test): realtime/suggestionAuthors.test.ts "an app's proposal made while another app's suggestions are withdrawn is still withdrawn when that app is revoked" |
| INT-107 | Moderation `act` is not atomic: the target changes but the action record, appeal link or notice can be missing | Suspected | Low | [#192](https://github.com/antonber/freero/issues/192) | partly fixed: listing and template decisions are atomic (listings.test.ts "a listing decision that can't be recorded doesn't happen …"); board, upload and user actions still record after their effect — open in #192 |
| INT-108 | A digest the SMTP server refuses permanently is retried every interval, forever, and can starve others | Suspected | Low | [#189](https://github.com/antonber/freero/issues/189) | fixed: notifications/digestJob.test.ts "a digest the mail server refuses for good is not tried again every run and is given up on, while other people's digests still go out" |
| INT-204 | A Figma token refresh or drop in flight can overwrite or delete a connection made after it started | Suspected | Low | [#193](https://github.com/antonber/freero/issues/193) | fixed: figma/figma.test.ts "a Figma connection made while an older one’s token refresh was in flight stays as it was …" |
| INT-109 | An appeal arriving while the kept copy is being purged is accepted for a copy deleted a moment later | Suspected | Low | [#192](https://github.com/antonber/freero/issues/192) | open (#192) |
| FAC-10 | Live activity results can be overwritten by an older snapshot when two server instances publish at once | Suspected | Low | [#203](https://github.com/antonber/freero/issues/203) | open: suspected, needs two instances to reproduce |
| FAC-11 | Two people starting a presentation on different server instances both present | Suspected | Low | [#203](https://github.com/antonber/freero/issues/203) | open: suspected, needs two instances to reproduce |
| FAC-12 | Two editors saving the board's call link at the same moment can leave one of them showing the old link | Suspected | Low | [#203](https://github.com/antonber/freero/issues/203) | open: suspected |

## Identity and access (ID)

### Machines

#### ID-M1. Browser session (`sessions`)
- Where: `auth/migrations/202610270900_users_sessions.sql:12`, columns added in `202610281000_accounts.sql`, `202610282000_sign_in_methods.sql`. The SSO single-logout side table is `sso_sessions` (`sso/migrations/202611301010…`, FK to `sessions.token_hash` ON DELETE CASCADE).
- States: **live** (row exists, `expires_at > now`, user not suspended), **expired** (row exists, `expires_at <= now`; ignored by `findSessionUser` `auth/repo.ts:305-314`, purged by a job), **ended** (row deleted), **frozen** (row exists but `users.suspended_at` is set; never resolves).
- Invariants: only a sha256 of the cookie is stored. A session never outlives `SESSION_TTL_MS` or the IdP's `SessionNotOnOrAfter` (`auth/service.ts:384`). A suspended account has no usable session. When every session ends, the account's API credentials end too (`onSignedOutEverywhere`, wired in `apiauth/wiring.ts:8`). Live sockets close when their session ends, on every instance (`auth/service.ts:263-299`, with a periodic re-check at `:321`).
- Transitions:
  | from → to | trigger | guard | file:line |
  |---|---|---|---|
  | none → live | signup, login, reset link, two-step, provider or SSO sign-in | `refuseIfSuspended`, `assertSignInAllowed` (in `completeSignIn`) | `auth/service.ts:372-412`, `auth/signIn.ts:42-71` |
  | live → ended | logout | none (idempotent; the SLO redirect is dropped if the row was already gone) | `auth/service.ts:489-509` |
  | live → ended | "revoke" one session / "revoke others" | owner of the session | `auth/routes.ts:314-336` |
  | live → ended (all) | password reset, email revert, two-step recovery, suspension, deletion scheduled, deprovisioning, unverified-account takeover by a provider | none | `auth/service.ts:516-522` |
  | live → ended | workspace session policy (max age or idle) | checked on every read, plus an enforcement job | `auth/service.ts:661-675`, `:627-642` |
  | live → ended (non-SSO sessions only) | SSO enforced | the break-glass owner is exempt | `sso/connections.ts:224-228` |
  | live → frozen | suspension racing a sign-in | `findSessionUser` filters `suspended_at` | `auth/repo.ts:313` |
- Retries: deleting the same session twice returns 404 or null, which is harmless.

#### ID-M2. Emailed one-time links (`auth_tokens`)
- Where: `auth/migrations/202610281000_accounts.sql:21`. Purposes are `verify_email | change_email | reset_password | revert_email | two_factor_undo | two_factor_recovery | two_factor_recovery_cancel` (`202610301000_two_factor_recovery.sql`).
- States: **pending** (row exists), **used or cancelled** (row deleted), **expired** (row exists past `expires_at`; `takeToken` deletes it and then refuses it, `auth/repo.ts:483-494`).
- Invariants: each link works once. Issuing a link replaces the earlier one of the same purpose (`auth/emails.ts:36-42`). Verifying an address takes effect only while it is still the account's address (`markEmailVerified … WHERE email = $2`, `auth/repo.ts:155-161`). **Expected but not held (ID-6):** a reset or change of the password should cancel every pending account-changing link.
- Transitions:
  - pending → used: `verifyEmail`, `resetPassword`, `confirmEmailChange`, `revertEmailChange` (`auth/emails.ts:60-64`, `:96-109`, `:178-207`, `:216-240`). `DELETE … RETURNING`, so of two concurrent uses only one wins.
  - pending → cancelled:
    - `changePassword` cancels `reset_password` only (`auth/emails.ts:131`).
    - `confirmEmailChange` cancels `verify_email` (`:191`).
    - Connecting a provider to an unverified account cancels `change_email` and `reset_password` (`auth/providers.ts:156-157`).
    - `revertEmailChange` cancels everything except `two_factor_undo` (`:236`).
    - `resetPassword` cancels **nothing** (ID-6).

#### ID-M3. Two-step sign-in challenge (`auth_challenges`)
- Where: `auth/migrations/202610282000_sign_in_methods.sql:43`.
- States: **pending** (attempts < max, not expired), **exhausted or expired**, **consumed** (deleted).
- Transitions:
  - none → pending: `completeSignIn` when two-step is on (`auth/signIn.ts:61-67`).
  - pending → pending+1: each code attempt, one atomic statement with `attempts < max` (`auth/repo.ts:682-691`).
  - pending → consumed: right code, then `deleteChallenge` (only one of two racing right codes signs in, `auth/signIn.ts:127`). The sign-in policy is re-checked after the code (`:130`).

#### ID-M4. Authenticator enrolment and delayed recovery (`user_totp`, `auth_two_factor_recoveries`, `users.password_via_link_at`)
- `user_totp.enabled_at` null means enrolling, set means on. `savePendingTotp` and `enableTotp` are guarded (`auth/twoFactor.ts:155-191`). Each time step is used once (`useTotpStep`).
- Recovery: started → reminded → ready → finished or cancelled. Starting needs a password that was not set through an emailed link. Any accepted second-factor code cancels it (`auth/twoFactor.ts:128-135`).

#### ID-M5. Account (`users`)
- States, from fields:
  - **unverified**: `email_verified_at` null.
  - **verified**.
  - **pending deletion**: `deletion_scheduled_for` set.
  - **suspended**: `suspended_at` set.
  - **passwordless**: `password_hash` null.
  - **purged**: row deleted.
- Transitions:
  - unverified → verified: verification link, invite link, reset link, provider or directory vouching (`auth/service.ts:226-257`, `auth/repo.ts:155`).
  - active → pending deletion → (restore) active, or → purged: `auth/account.ts:12-41`. The purge re-checks `deletion_scheduled_for <= now` in the same `DELETE` (`auth/repo.ts:237`).
  - unverified + provider sign-in with a vouched matching email → password wiped, links cancelled, sessions ended, verified (`auth/providers.ts:154-160`). This is the defence against a squatted account; ID-1 shows two paths that skip it.

#### ID-M6. Provider sign-in flow (`auth_oidc_flows`) and identities (`auth_identities`)
- Flow: pending → taken (`DELETE … RETURNING`, `auth/repo.ts:635`) or expired (purged).
- Identity link: none → linked (unique per (provider, issuer, subject) and per (user, provider)). A concurrent first sign-in is retried once (`auth/providers.ts:70-76`). Unlinking the last way in is refused (`deleteIdentityIfNotLast`).

#### ID-M7. Guest session (`guest_sessions`)
- States: live → removed (`removed_at` set; the row stays so the same browser can't rejoin) → purged at expiry; or live → expired → purged. Board deletion cascades (`auth/migrations/202610301020_guest_sessions.sql`, `202612040920_guest_removed.sql`, `auth/guests.ts:93-113`).

#### ID-M8. OAuth client (`oauth_clients`)
- Kinds: **manual** (`owner_id` set), **dynamic** (no owner, no metadata expiry), **metadata** (`metadata_expires_at` set) (`apiauth/oauth.ts:77`).
- Transitions:
  - registered → deleted by its owner, which cascades to grants, tokens and codes (`apiauth/repo.ts:294`).
  - An unused dynamic client is dropped after a week, only when it has no grant (`apiauth/repo.ts:307-310`).
  - A metadata client is upserted only while it stays ownerless and secretless (`apiauth/repo.ts:261-267`).

#### ID-M9. OAuth consent and token chain (`oauth_grants`, `oauth_codes`, `api_tokens` kind access/refresh)
- Where: `apiauth/migrations/202611021000_api_credentials.sql`.
- States:
  - Grant: **absent** or **present** (one per client and user; a new consent replaces it **in place**, keeping its `id`, `apiauth/repo.ts:350-360`).
  - Code: **pending** or **redeemed** (deleted). An expired code stays until it is purged.
  - Refresh token: **fresh** (`used_at` null), **used** (`used_at` set; kept until `expires_at` so a replay can be detected), **deleted** (with its grant).
  - Access token: valid until `expires_at` or until its grant is deleted.
- Invariants:
  - A code works once and only with its PKCE verifier.
  - A replayed refresh token ends the whole grant.
  - **Expected but not held (ID-3):** tokens never carry more than the current grant allows.
  - **Expected but not held (ID-2):** an app's own retried or concurrent refresh doesn't end its consent.
- Transitions:
  | from → to | trigger | guard | file:line |
  |---|---|---|---|
  | grant absent/present → present, plus a pending code | consent "Allow" | none (upsert keeps the grant id and old tokens) | `apiauth/oauth.ts:305-333` |
  | code pending → redeemed, and tokens issued | token endpoint, authorization_code | code deleted first (single use); then client, expiry, redirect and PKCE checked; grant must exist | `apiauth/oauth.ts:390-405`, `apiauth/repo.ts:416` |
  | refresh fresh → used, and a new pair issued | token endpoint, refresh_token | `UPDATE … WHERE used_at IS NULL` | `apiauth/oauth.ts:406-431`, `apiauth/repo.ts:174-182` |
  | refresh used → grant deleted (all tokens cascade) | the same refresh token again | it is a refresh token of this client | `apiauth/oauth.ts:409-416` |
  | grant present → absent | the person revokes the app, "disconnect everything", signed out everywhere, client deleted | none | `apiauth/oauth.ts:459-464`, `apiauth/repo.ts:197-205` |
  | token → deleted | RFC 7009 revoke (a refresh token takes its grant's tokens along) | it belongs to this client | `apiauth/oauth.ts:436-441` |

#### ID-M10. Personal access token (`api_tokens` kind personal)
- States: **active**, **paused** (`paused_at` set), **expired** (`expires_at <= now`), **revoked** (deleted).
- Quota: `lockTokenQuota` and the count run in one transaction (`apiauth/credentials.ts:100-119`).
- Every request re-reads the token. Pause, revoke, suspension, pending deletion and the SSO restriction all apply on the next request (`apiauth/credentials.ts:193-241`).

#### ID-M11. Live-view ticket and token, export ticket (`api_embed_tokens`, `api_export_tickets`)
- Live view: ticket pending → redeemed into a token (`UPDATE … WHERE ticket_hash = $1 AND token_hash IS NULL`, `apiauth/repo.ts:521-529`) → expired.
- Export ticket: `DELETE … RETURNING` (`apiauth/repo.ts:560-571`).
- Both cascade with their grant or personal token. Open views are re-checked every `sessionRecheckMs` and closed when the credential can no longer act (`embed/init.ts:15-35`).

#### ID-M12. Workspace API policy per credential (`api_workspace_credentials`)
- **seen**, **blocked** (`blocked_at`), **ip_exempt**. The id stays the same across re-authorisation (`<clientId>:<userId>`), so re-consenting doesn't shed a block (`apiauth/migrations/202611021000…:77-90`).

#### ID-M13. SSO connection (`sso_connections`)
- States: **absent** → **saved, disabled** → **enabled** → **tested** (`tested_at` set) → **enforced**.
- Invariants: enforced requires enabled and tested (one guarded `UPDATE`, `sso/repo.ts:218-225`). Changing the provider or disabling the connection clears `tested_at` and `enforced` (`sso/repo.ts:187`, `:194`). The break-glass person is exempt only while they are still an owner, checked live (`sso/policy.ts:36`).
- Transitions:
  - save (`sso/connections.ts:82-181`)
  - enforce or unenforce (`:197-230`)
  - mark tested after a successful directory sign-in (`sso/signIn.ts:359`, unguarded; see ID-10)
  - remove (`:183-188`)

#### ID-M14. SSO domain claim (`sso_domains`)
- States: **pending** (`verified_at` null; `last_checked_at` records failed checks) → **verified**. There is **no failed, expired or re-verify state**; see ID-8.
- Invariants: at most one verified claim per domain (unique partial index, `sso/migrations/202611011100_sso.sql`). `markDomainVerified` uses `COALESCE` and maps a unique violation to 409 (`sso/repo.ts:74-81`).
- Transitions: add (`sso/domains.ts:26`), verify (`:38-63`), remove (`:65-72`).

#### ID-M15. Domain capture (`sso_domain_captures`) and capture of new verified sign-ups
- States: pending (`joins_at`) → joined, or → voided (address changed or unverified, account being deleted, domain no longer this workspace's), or → cancelled by an admin. The job is idempotent; `takeCapture` runs after each one (`sso/domainControl.ts:149-176`).

#### ID-M16. SSO sign-in flow (`sso_flows`)
- States:
  - SAML: pending → answered (`result` set once, `AND result IS NULL`) → taken (`DELETE … AND result IS NOT NULL`).
  - OIDC: pending → taken.
  - IdP-initiated: inserted already answered.
- All are bound to the browser hash (`sso/repo.ts:300-344`). The domain and the connection's `enabled` flag are re-checked when the flow completes (`sso/signIn.ts:280-282`, `:328-332`).

#### ID-M17. SCIM user (`scim_users`) mapped onto workspace membership
- States: **provisioned active**, **provisioned inactive** (the workspace member is deactivated), **deleted** (the record is gone and the member stays deactivated).
- Group mappings decide the role, projects and organisation workspaces (`scim/service.ts:139-166`).
- Transitions:
  - create (`scim/service.ts:203-222`)
  - replace or patch: active → inactive deprovisions, inactive → active reactivates (`:225-256`)
  - delete (`:262-267`)
  - group membership changes (`:282-292`)
- Invariants: the directory owns provisioned people (an admin's manual removal is undone at the next sync). Owners are never changed. **Expected but not held (ID-1):** the account being provisioned belongs to the person at that address.

#### ID-M18. Workspace membership, roles and invites (`workspace_members`, `workspace_invites`)
- States per person: **none**, **member(role ∈ owner/admin/member/guest)**, **deactivated** (`deactivated_at` set; keeps the role, opens nothing).
- Invites: **pending** → accepted (deleted, `DELETE … RETURNING`), revoked, or expired.
- Invariants:
  - Every team workspace has at least one **active** owner (`isLastActiveOwner`, `workspaces/repo.ts:643-650`). **Not held under concurrency (ID-4).**
  - Only owners change owner and admin roles.
  - **Expected but not held (ID-5):** the actor's authority holds at the moment the change commits.
  - **Expected but not held (ID-7):** a pending invite stays valid only while its inviter may still invite.
- Transitions:
  | from → to | trigger | guard | file:line |
  |---|---|---|---|
  | none → member | invite of an existing account (`addMemberIfAbsent`) or invite link or verified address (`grantAtLeast`, never lowers, never touches an owner) | the inviter's role and the policies at invite time only | `workspaces/invites.ts:63-117`, `:148-166`, `workspaces/repo.ts:583-610` |
  | role → role | `changeRole` | actor role read before the lock; last active owner checked under the lock | `workspaces/service.ts:668-707` |
  | owner A → admin, B → owner | transfer | actor role re-checked under the lock | `workspaces/service.ts:593-615` |
  | member → none | `removeMember`, leave | last active owner checked under the lock; heir = the first owner | `workspaces/service.ts:713-740` |
  | member → none | directory removal (never an owner) | under the lock | `workspaces/service.ts:747-772` |
  | active ⇄ deactivated | `setMemberDeactivated` | actor role read before the lock; **no last-active-owner check** | `workspaces/service.ts:778-799` |

#### ID-M19. Board membership, invites and access requests (`board_members`, `board_invites`, `board_access_requests`)
- Membership: none → role(editor/commenter/viewer, plus `co_owner`) → none. `grantAtLeast` never lowers a role (`members/repo.ts:254-271`).
- Invites: pending → accepted (`DELETE … RETURNING`, `members/repo.ts:347`), revoked, renewed (`UPDATE` returns null once used), or expired.
- Access requests: none → **pending** → approved or denied; a denied request can be refiled after a one-hour cooldown, an approved one at any time (`members/repo.ts:436-459`). A decision is a single `UPDATE … WHERE status='pending'` inside a transaction together with the grant (`members/accessRequests.ts:155-160`, `members/repo.ts:480-492`).
- The effective role is resolved on every read: workspace blocked, outsider blocked, link capped by policy, link expiry and passwords (`members/roles.ts:61-79`, `boards/repo.ts:96`, `boards/service.ts:266-315`).

---

#### Changes made by the fixes

These supersede the machine descriptions above where they differ.

- **OAuth consent and token chain (M9):** refresh rotation (`rotateRefreshToken`) and code redemption are each one transaction that locks the consent row, then the token (`FOR UPDATE`, always grant before token, the order consent deletion uses). Refresh tokens: `fresh → used` keeps `used_at` and links successors through `api_tokens.rotated_from`; new transition `used → used + another pair` when the same client presents it within 60 s (`REFRESH_RETRY_WINDOW_MS`) of its first use and no successor has been used; outside that, `used → consent deleted` (replay). An expired refresh token is refused with no state change. The consent is the source of truth: scopes at authentication, refresh, code exchange and in live views are limited to the current grant's scopes, and a token or code for a resource other than the grant's is refused. Re-consent still updates the grant in place (installs sharing one client id stay signed in), and existing tokens are narrowed live.
- **Emailed links (M2):** `resetPassword` and `changePassword` cancel the pending `change_email` and `reset_password` links (`cancelAccountChanges`); the owner's ways back (`revert_email`, the two-step undo and recovery-cancel links) are kept.
- **Account and provider identities (M5, M6):** an unverified account whose address a provider, a directory sign-in or SCIM vouches for is claimed when the account is resolved, before any workspace membership and before any second step (`claimUnverifiedAccount`, row locked while the address is unchanged and unverified): its password, two-step and recovery, other provider identities, pending links and sessions (and so API credentials) end, and the address is marked verified. Invariant: an account whose address was never verified is never handed to a workspace with credentials its creator set up.
- **SSO connection (M13):** "mark tested" is compare-and-set on the connection's `updated_at` as it was when the sign-in's answer was validated; any save in between means that sign-in proves nothing.
- **SCIM user (M17):** a replace is a compare-and-set on `active` that returns the previous value, and the service branches on what its own update changed; deactivation and reactivation apply only while the record still says so, checked under the workspace lock.
- **Workspace membership and invites (M18):** every membership change (role, remove, deactivate, transfer) locks the workspace first and authorises the actor inside the lock (`lockAndRequire`); invite and resend authorise under a `share` lock. Invariant now enforced: a team workspace always keeps an active owner (deactivation checks the last active owner; transfer to a deactivated member is refused; leaving picks an active owner as heir, else refuses with 409). An invite is accepted only while its inviter is an active member who may still invite at its role (re-checked at acceptance under the lock, `inviterStillVouches`); otherwise it stays pending and dead until it expires, is revoked or is resent, and resending re-attributes it to the resender.
- **Board membership and invites (M19):** inviting, changing a role and removing take the board row `FOR NO KEY UPDATE` (`lockBoardSharing`), then authorise; board invite acceptance runs under that lock and requires the inviter to still be allowed to share the board (and outside the workspace, if the invitee is outside it). Still authorising before the write: group shares and access-request decisions (narrow window, not in these findings).

### Findings

#### ID-1: Directory provisioning hands a company's workspace to whoever squatted the employee's address
- **Status: CONFIRMED** for SCIM (failing test). **CONFIRMED by trace** for the SSO path in (b).
- **Evidence:**
  - (a) **SCIM.** `scim/service.ts:206-221` → `auth/providers.ts:119-123`: `provisionDirectoryAccount` returns any existing account with that address (`if (user) return { userId: user.id, created: false }`), verified or not. Then `syncPerson` makes it a member (`scim/service.ts:139-147`). Nothing wipes the password or sessions the account's creator set up, unlike `connectIdentity` (`auth/providers.ts:154-160`).
    - Sequence:
      1. An attacker signs up `alice@corp.com` (no verification needed; signup is refused only while SSO is *enforced*, `auth/routes.ts:65`).
      2. Corp verifies `corp.com` and its directory provisions Alice.
      3. The attacker's password (and any live session) now opens an account that is an editor on Corp's boards.
    - Test `scim/stateAudit.test.ts` › "provisioning an address someone else signed up with (never verified) does not hand that person the workspace" fails: `expected { squatterPasswordWorks: true, boardRole: 'editor' } to not deeply equal …`.
  - (b) **SSO just-in-time sign-in.** `sso/signIn.ts:333-349`: `resolveDirectoryLogin` returns the existing account plus a pending `link` (`auth/providers.ts:99-100`). `applyDirectoryMembership` then adds it to the workspace **before** `completeSignIn`. If the squatter turned on two-step verification (allowed on an unverified account, `auth/twoFactor.ts:155-191`), `completeSignIn` stops at the challenge (`auth/signIn.ts:61-67`), and `connectIdentity` (the wipe) only runs after a second step the real person can't pass (`auth/signIn.ts:131`). The squatter's account stays a workspace member with its password intact.
- **Impact: High.** Account pre-hijacking that grants a company workspace. It needs only a guessable work address and an attacker who signs up before the company rolls out SCIM or SSO. Signup at the domain stays open until SSO is enforced.
- **Security-sensitive:** yes.
- **Fix:** treat "the directory vouches for an address whose account was never verified" exactly like `connectIdentity` does: wipe the password, cancel pending links, end sessions, mark it verified and drop two-step verification set up before verification. Do this in `provisionDirectoryAccount`, and in the SSO path before membership is granted (or grant membership only after `completeSignIn` has connected the identity).
  - Regression tests: the failing SCIM test above, plus an SSO variant where the squatter has two-step verification on.

#### ID-2: A retried or concurrent refresh with the same refresh token disconnects the app (and the winning refresh fails with a 500)
- **Status: CONFIRMED** (failing test).
- **Evidence:** `apiauth/oauth.ts:406-431`.
  - Request 1 marks the token used (`apiauth/repo.ts:174-182`). Request 2 finds it used, treats it as a replay and deletes the whole grant (`apiauth/oauth.ts:409-416`).
  - Request 1 then reaches `issueTokens`, and `insertToken` violates `api_tokens_grant_id_fkey` because the grant is gone. That raw database error surfaces as a 500, not an OAuth error.
  - Rotation is also not atomic. The refresh token is used up in its own statement before the new pair is inserted (`apiauth/oauth.ts:359-381`, no transaction), so a failure in between, or a response lost on the network, leaves the client holding only a used token. Its retry is then treated as a replay and ends the consent.
  - Test `apiauth/stateAudit.test.ts` › "two refreshes the same app sends at once with its current refresh token do not disconnect the app" fails. Observed results: `["insert or update on table \"api_tokens\" violates foreign key constraint \"api_tokens_grant_id_fkey\"", "The refresh token is invalid, expired or already used"]`, so both requests fail.
- **Impact: Medium.** MCP clients and agents that fire parallel tool calls when the access token expires (or retry after a timeout) are disconnected and the person must reconnect the app. A replay alarm is audited for a non-attack. This is likely in practice for busy MCP clients.
- **Security-sensitive:** yes (token lifecycle), but the harm is availability. Replay detection itself is correct.
- **Fix:**
  - Rotate in one transaction: lock the refresh row (`SELECT … FOR UPDATE`), mark it used, insert the pair, commit.
  - Give a just-rotated token a short grace window (for example 30–60 s) in which presenting it again from the same client returns, or re-issues, the successor instead of revoking the grant. Revoke only for presentations after the window or from a different client.
  - Regression test: the failing test above, plus "a refresh whose response was lost can be retried once within the grace window".

#### ID-3: Re-consenting an app with fewer permissions doesn't take them away from tokens it already holds
- **Status: CONFIRMED** (failing test).
- **Evidence:**
  - A new consent updates the grant row **in place, keeping its id** (`apiauth/repo.ts:350-360`). The old access and refresh tokens (same `grant_id`) survive.
  - Refresh copies the scopes of the used token (`apiauth/oauth.ts:425`, `let scopes = used.scopes`) and never intersects them with `grant.scopes`. Bearer authentication trusts `token.scopes` (`apiauth/credentials.ts:236`).
  - So the old refresh chain keeps an opt-in scope (for example MCP `boards:write`) that the person turned off, for as long as the app keeps refreshing (every 30 days, indefinitely).
  - Related: code redemption issues `code.scopes` under `grant.resource` (`apiauth/oauth.ts:401-404`, `:375`). A code from an earlier consent for another resource yields a token for the current grant's resource with the earlier consent's scopes.
  - Test `apiauth/stateAudit.test.ts` › "re-consenting an app with fewer permissions takes the dropped scope away from the tokens it already holds" fails: `expected [ 'boards:read', 'boards:write' ] to not include 'boards:write'`.
- **Impact: Medium.** The person believes they narrowed an agent to read-only, but it keeps write access to boards. It needs the person to reconnect with narrower choices, which the consent screen invites.
- **Security-sensitive:** yes.
- **Fix:** the grant is the source of truth. On re-consent, either delete the grant's existing tokens (and give the grant a new id) or, at minimum, intersect scopes with the current `grant.scopes` (and use `code.resource` ⊆ grant) at refresh and redemption time. Authentication could also check `token.scopes ⊆ grant.scopes`.
  - Regression test: the failing test above.

#### ID-4: Two owners deactivating each other at once leaves the workspace with no active owner (unrecoverable without an operator)
- **Status: CONFIRMED** (failing test).
- **Evidence:**
  - `setMemberDeactivated` (`workspaces/service.ts:778-799`) checks only `mayRemove(actor, target.role)`. It has no last-active-owner check (compare `changeRole`, `:686`, and `removeMember`, `:727`).
  - The actor's own role and active status come from `requireWorkspace` **before** the lock (`:779`, `workspaces/service.ts:239-245`) and are not re-checked inside it.
  - Owners A and B each pass `requireWorkspace`. Under the lock, A deactivates B, then B's request (actor still read as an active owner) deactivates A. Both owners end up deactivated.
  - Afterwards nobody can reactivate them: a deactivated actor is refused, and admins may not touch owners. When the second deactivated owner tries to leave, `heir = …find(m.role==='owner')!.userId` dereferences undefined and returns a 500 (`:730`).
  - Test `workspaces/stateAudit.test.ts` › "a workspace keeps an active owner when its two owners deactivate each other at the same moment" fails: `expected [] to have a length of 1 but got +0`.
- **Impact: Medium.** The workspace has no administration at all. It needs two owners acting within the same moment, which is unlikely but permanent.
- **Security-sensitive:** yes (access control invariant).
- **Fix:** inside the locked transaction, re-read the actor's membership (role and `deactivated_at`) and refuse deactivating an owner when `isLastActiveOwner(target)`. Handle "no heir" in `removeMember`.
  - Regression test: the failing test above.

#### ID-5: A just-demoted owner or admin's in-flight request still runs with the old role
- **Status: CONFIRMED** (failing test).
- **Evidence:** `changeRole`, `removeMember` and `setMemberDeactivated` authorise the actor in `requireWorkspace` (`workspaces/service.ts:671`, `:715`, `:779`) **outside** the transaction. Inside `lockWorkspace(… 'update')` they re-check only the target. Only `transferWorkspace` re-checks the actor under the lock (`:600`).
  - Interleaving with owners A, B, C:
    1. Both requests pass `requireWorkspace`.
    2. A's transaction demotes B.
    3. B's transaction, with its stale `actor='owner'`, demotes C.
  - Test `workspaces/stateAudit.test.ts` › "an owner demoted a moment ago can no longer demote the other owners" fails: in the audit chain, B's role change commits after B's demotion.
  - The same pattern exists for board co-owners (`members/service.ts:116-148`, `requireBoardAccess` before an unconditional write), by trace.
- **Impact: Low–Medium.** A narrow window, but it is exactly the moment someone is being demoted in a dispute. A demoted owner can still demote, remove or deactivate others.
- **Security-sensitive:** yes.
- **Fix:** take the workspace lock first, then authorise (re-read the actor's role, `deactivated_at` and admin scopes inside the transaction). The same applies to board co-owner actions, for example by locking the board row.
  - Regression test: the failing test above.

#### ID-6: An email change someone else started survives the password reset the notice tells the owner to do
- **Status: CONFIRMED** (failing test).
- **Evidence:**
  - `requestEmailChange` emails a 24 h `change_email` link to the new address (`auth/emails.ts:139-170`) and tells the current address "If this was not you, change your password now" (`auth/locales/en.json:20`).
  - `resetPassword` (`auth/emails.ts:96-109`) cancels no pending links. `changePassword` cancels only `reset_password` (`:131`).
  - `confirmEmailChange` needs no session, only the link (`:178-207`). The thief confirms after the owner has reset the password: the account moves to the thief's address, and the thief can then reset the password from it.
  - Mitigation: the previous address gets a 7-day "revert" link, but only if it was verified (`:193`).
  - Test `auth/stateAudit.test.ts` › "resetting the password (what the "email is changing" notice tells the owner to do) cancels an email change someone else started" fails: `expected 'thief@…' to be 'vic@…'`.
- **Impact: Medium.** Account takeover after the owner did what the notice told them. It needs the attacker to have had the password or a recently authenticated session once. Accounts with an unverified address have no revert path.
- **Security-sensitive:** yes.
- **Fix:** a password reset or change (and any "signed out everywhere") should cancel every pending account-changing link (`change_email`, `reset_password`, the two-factor links as appropriate) in the same step.
  - Regression test: the failing test above (plus the `changePassword` variant).

#### ID-7: Invitations sent by an admin keep working after that admin is removed (or demoted)
- **Status: CONFIRMED** (failing test) for workspace invites. Board invites behave the same by trace.
- **Evidence:**
  - `removeMember` and `changeRole` (`workspaces/service.ts:668-740`) never touch `workspace_invites`. Its `invited_by` FK only cascades on account deletion (`workspaces/migrations/202610291000_workspaces.sql`). `acceptInvite` checks only that the token is live (`workspaces/invites.ts:148-158`).
  - So an admin can invite a second address of their own, get removed, and join again through that invite for up to 14 days. The same holds for an invite with `role: 'admin'` sent before a demotion.
  - Board invites behave the same: `removeBoardMember` and `setBoardMemberRole` leave the inviter's `board_invites` live (`members/service.ts:116-148`, `members/invites.ts:100-116`).
  - Test `workspaces/stateAudit.test.ts` › "the invitations an admin sent stop working once that admin is removed from the workspace" fails: `promise resolved "{ workspaceId: … }" instead of rejecting`.
- **Impact: Low–Medium.** A removed insider keeps a way back in. Admins can revoke pending invites in the console, but nothing prompts them to.
- **Security-sensitive:** yes.
- **Fix:** when a member is removed, demoted below the invite's role, or deactivated, delete (or re-attribute to the remover) the pending workspace and board invites they sent. Alternatively, re-check at acceptance that `invited_by` may still invite at that role (`mayInvite`).
  - Regression test: the failing test above.

#### ID-8: A verified domain never expires or re-verifies
- **Status: SUSPECTED.** This is a missing transition rather than a code race, so it is reachable only when a domain changes hands.
- **Evidence:** `sso_domains` has no failed or expired state. Verification is checked once (`sso/domains.ts:38-63`, `COALESCE(verified_at, …)` at `sso/repo.ts:76`), and no job re-checks the TXT record.
  - Everything that trusts the domain keeps trusting it: JIT sign-in and account linking (`sso/signIn.ts:328`), SCIM provisioning of existing accounts (`scim/service.ts:205`), enforcement, which ends sessions (`sso/connections.ts:226`), sign-up capture (`sso/domainControl.ts:182`), and blocking workspace creation (`:222`).
- **Impact: Low.** If a company's domain lapses and is re-registered by someone else, or a workspace that verified it is abandoned, the old workspace keeps authority over addresses there and blocks a new owner from proving the domain (the unique verified index).
- **Security-sensitive:** yes.
- **Fix:** add a periodic re-check (`verified → failing → unverified` after N consecutive misses, with admin notice).
  - Regression test: "a domain whose TXT record is gone for N checks stops routing and provisioning".

#### ID-9: Concurrent SCIM `active:false` and `active:true` for one person can leave the record active while the member stays deactivated
- **Status: SUSPECTED** (traced; IdPs usually serialise per user).
- **Evidence:** `replaceUser` reads `prev` (`scim/service.ts:226`), writes `active` (`:234`) and branches on `prev.active` (`:242-252`).
  - Two PATCHes both read `prev.active = true`. The false one deprovisions. The true one only calls `syncPerson`, which "never reactivates" (`:131-136`). If the true update lands last, `scim_users.active = true` but the member stays deactivated.
  - Further `active:true` PATCHes see `prev.active = true` and never reactivate. The member stays stuck until the directory sends false then true again.
- **Impact: Low.**
- **Security-sensitive:** no (it fails closed).
- **Fix:** make the transition a compare-and-set (`UPDATE scim_users SET active=$x WHERE … RETURNING (old) active`) and branch on what the update actually changed. Alternatively, reconcile deactivation from the record state in `syncPerson`.

#### ID-10: `markTested` is unconditional, so a sign-in validated against the old provider can mark a just-changed provider "tested"
- **Status: SUSPECTED** (narrow window).
- **Evidence:** `completeDirectorySignIn` validates against the connection read at callback time (`sso/signIn.ts:280-306`) and ends with `repo.markTested(workspaceId, now)` (`sso/signIn.ts:359`, `sso/repo.ts:227-229`).
  - If an admin saves a new provider in between (which clears `tested_at`, `sso/repo.ts:194`), `markTested` re-sets it for a provider no sign-in has proven. Enforcing is then allowed (`sso/repo.ts:218-222`), which can lock everyone but the break-glass owner out.
- **Impact: Low.**
- **Security-sensitive:** no (availability).
- **Fix:** mark tested only if the connection still has the provider fields (or `updated_at`) that the sign-in was validated against (`UPDATE … WHERE updated_at = $seen`).

---

### Checked and fine

- **OAuth authorization codes**:
  - single use (`DELETE … RETURNING`, `apiauth/repo.ts:416`); a wrong verifier or client burns the code (`apiauth/oauth.ts:391-399`)
  - no PKCE downgrade: a code issued without a challenge needs the secret and no verifier (`:394-396`)
  - a revoked grant blocks redemption (`:401-403`)
- **Refresh replay from another client** never revokes someone else's grant (the `clientId` check, `apiauth/oauth.ts:412`). Used refresh tokens are kept until `expires_at` so replay detection lasts the token's life (`apiauth/repo.ts:436-440`).
- **Personal tokens**:
  - quota race (advisory lock plus count in one transaction)
  - pause and resume (`UPDATE … RETURNING`)
  - revoke cascades to live views and export tickets (FK) and withdraws suggestions (outbox in the same transaction)
  - every request re-reads the token, so pause, revoke, suspension, deletion and the SSO restriction apply immediately
- **Live-view and export tickets** are single use (conditional `UPDATE`/`DELETE`). Open views are re-validated every `sessionRecheckMs` and closed when their grant, token or workspace policy changes (`embed/init.ts:15-35`).
- **Dynamic client cleanup** never deletes a client with a grant (`apiauth/repo.ts:307-310`). A metadata-client upsert can't overwrite a manual or confidential client (`:267`).
- **Sessions**:
  - suspension racing a sign-in: `startSession` refuses, and a slipped-in row never resolves (`auth/repo.ts:313`)
  - ended sessions close sockets on every instance (pub/sub, plus a periodic DB re-check, `auth/service.ts:277-332`)
  - workspace session policies are enforced on read and by a job
  - "revoke others" keeps the current session
  - `SESSION_SECRET_PREVIOUS` rotation doesn't affect sessions (random tokens, only their sha256 stored; no signature). It only reseals TOTP secrets, via a job (`auth/init.ts:80-97`).
- **Two-step challenge**: the attempt counter is one atomic statement (`auth/repo.ts:682-691`); two right codes racing sign in once (`auth/signIn.ts:127`); the policy and suspension are re-checked after the code. TOTP time steps are used once (`useTotpStep`). Recovery codes are used once.
- **Emailed links**: single use (`DELETE … RETURNING`, `auth/repo.ts:483-494`); verifying an old address after an email change is a no-op (`WHERE email = $2`); `confirmEmailChange` maps a unique violation to 409. Two concurrent "forgot password" requests can leave two live links (delete-then-insert, `auth/emails.ts:36-42`), both to the same mailbox: harmless.
- **Provider sign-in**:
  - matching an existing account needs a verified email claim (`auth/providers.ts:64`)
  - a provider vouching for an unverified account's address wipes the squatter's password, links and sessions (`:154-160`; see ID-1 for the two paths that bypass this)
  - concurrent first sign-ins retry once (`:70-76`)
  - unlinking the last way in is refused
- **Account deletion**: scheduling ends sessions and API credentials; restore is compare-and-set (`auth/repo.ts:214-219`); the purge re-checks due-ness in the same `DELETE` (`:237-242`).
- **SSO**:
  - flows are single use and browser-bound (`sso/repo.ts:300-344`)
  - the domain and the connection's `enabled` flag are re-checked at completion
  - enforcing requires enabled and tested in the same `UPDATE` (`sso/repo.ts:218-222`)
  - a provider change or disabling clears enforced and tested (`:187`, `:194`)
  - the break-glass exemption is live (owner now, `sso/policy.ts:36`)
  - a deactivated member can't sign in through SSO (`sso/signIn.ts:335-338`)
  - domain capture voids on an address change, unverified address, pending deletion or lost domain (`sso/domainControl.ts:138-146`); the domain-verified uniqueness race maps to 409
- **SCIM**: deprovisioning ends sessions and credentials for organisation addresses; reactivation is only via the directory's false→true; an admin's manual removal or reactivation of a provisioned person is overridden at the next sync (directory-owned, by design, `scim/service.ts:8-17`).
- **Workspace last owner**: concurrent mutual demotion keeps one owner (existing test `workspaces/workspaces.test.ts:62-72`, under `lockWorkspace FOR UPDATE`); removal or leaving of the last active owner is refused; transfer re-checks the actor under the lock.
- **Workspace and board invites**: accept is single use (`DELETE … RETURNING`); resend returns 404 once used; `grantAtLeast` never lowers a role or touches an owner; accepting doesn't reactivate a deactivated member.
- **Access requests**: double approve or approve-versus-deny is decided by one `UPDATE … WHERE status='pending'` in the same transaction as the grant (`members/accessRequests.ts:155-160`). Approval re-checks that the requester isn't blocked or an outsider. Refiling after a denial respects the cooldown (`members/repo.ts:448-449`).
- **Board role resolution is dynamic**: workspace deactivation, outsider blocking, the link cap by policy, link expiry (`boards/repo.ts:96`) and link passwords apply on every read. Removing a member from a workspace drops their board memberships there and refreshes live sockets (`workspaces/service.ts:733-739`).
- **Bearer API and MCP after removal from a workspace**: authorisation is per request via `getBoardAccess` and `useInWorkspace` (no cached role), so removal applies on the next call.
- **Microsoft Teams module** (`teams/`): stateless JWT verification and link previews. There is no state machine in this area.

## Board and data lifecycle (DATA)

### Machines

#### DATA-M1. Board lifecycle (implicit; `HeldBoard.state` names it)

Where it lives: `boards` columns `deleted_at`, `deleted_by` (migration `boards/migrations/202610281600_boards_trash.sql`), `removed_at`, `link_blocked_at` (`202610311001_board_moderation.sql`), `archived_at`, `archived_by` (`202611270910_board_archive.sql`), `discarded_at` (`202611301005_board_legal_holds.sql`), and whether the row exists. The state is derived in `boards/legalHolds.ts:54`: taken_down > deleted (discarded) > trashed > archived > live. `LIVE` = `deleted_at IS NULL AND removed_at IS NULL` (`boards/repo.ts:122`).

| State | Fields |
|---|---|
| live | deleted_at, removed_at, archived_at, discarded_at all NULL |
| archived | archived_at set, deleted_at and removed_at NULL |
| trashed | deleted_at set, discarded_at NULL, removed_at NULL |
| deleted (discarded) | deleted_at and discarded_at set. Only reachable while held. Hidden from everyone except the case. |
| taken_down | removed_at set. It can sit on top of any of the others: a trashed or archived board can also be taken down. |
| gone | the row is deleted. Terminal. |
| (orthogonal) link blocked | link_blocked_at set |

Invariants:

- I1. A held board (`HELD`, `boards/repo.ts:124`) never leaves the database. The `BEFORE DELETE` trigger enforces this.
- I2. discarded_at is set only when deleted_at is set and the board is held. The purge deletes it once no hold is left.
- I3. Only LIVE boards resolve for access.
- I4. A taken-down board is deleted only by an operator, and only when it is not held.
- I5. A board a person explicitly kept (restored or unarchived) is not removed again by a retention rule until a fresh notice and a full notice period have passed. This is the header promise in `boards/retention.ts:1-9`.

Transitions:

| from → to | trigger | guard | file:line |
|---|---|---|---|
| (none) → live | createBoard / duplicate / backup restore / template | quota lock, workspace lock | boards/service.ts:725, 1252, 1295 |
| live → trashed | owner DELETE (moveToTrash) | `UPDATE … WHERE deleted_at IS NULL` CAS; a retry returns false | boards/service.ts:963, repo.ts:390 |
| live → trashed | retention rule `trash` | one UPDATE re-checks workspace, live, unarchived, inactive, noticed | boards/retention.ts:97, repo.ts:491 |
| live → archived | owner / content admin; retention rule `archive` | `WHERE LIVE AND archived_at IS NULL` | boards/service.ts:1061, repo.ts:403, 491 |
| archived → live | unarchive | same CAS; bumps updated_at (the retention clock restarts) | repo.ts:403-408 |
| trashed → live | owner restore, admin restore | `WHERE deleted_at IS NOT NULL AND discarded_at IS NULL` CAS, quota lock. **Does not touch updated_at or retention_notice_at (DATA-1)** | boards/service.ts:993, 1134; repo.ts:395 |
| trashed → gone | owner "delete forever" (not held) | `DELETE … WHERE deleted_at IS NOT NULL AND removed_at IS NULL` | boards/service.ts:1171, repo.ts:769 |
| trashed → deleted | owner "delete forever" (held) | held check, then `discardTrashedBoard` CAS (same tx) | boards/service.ts:1161-1166, repo.ts:679 |
| trashed → deleted | purge round; the trash period ran out while held | `discardHeldExpired` | boards/service.ts:1203, repo.ts:585 |
| trashed / deleted → gone | hourly purge (`runExclusive` lock 7_202_610_282) | `DELETE … WHERE id IN (SELECT … NOT HELD … LIMIT)`; trigger | boards/service.ts:1192-1226, repo.ts:556 |
| any (not taken down) → taken_down | operator take_down, suspension | `WHERE removed_at IS NULL` CAS | boards/moderation.ts:127, repo.ts:208 |
| taken_down → previous state | operator restore, lifting a suspension | `WHERE removed_at IS NOT NULL` CAS | boards/moderation.ts:134 |
| taken_down → gone | operator delete | heldAmong check (409), then `DELETE … AND NOT HELD` | boards/moderation.ts:144, repo.ts:535 |
| live/any → gone | account purge (`deleteAllOwnedBy`), workspace delete (`deleteAllInWorkspace`) | caller waits / refuses on holds; trigger | repo.ts:519, 363 |
| owner/workspace change | transfer, hand-over, move to workspace | `moveToWorkspace` requires LIVE; `setOwner` / `transferOwnedIn` have no state guard. The trigger copies custodian holds onto the board | repo.ts:368, 378, 725 |

#### DATA-M2. Legal hold and case (#157)

Where it lives: `board_legal_holds(hold_id, board_id, via_owner)` and `board_owner_legal_holds(hold_id, workspace_id, owner_id)` (`boards/migrations/202611301005_board_legal_holds.sql`); `legal_cases.released_at` (`ediscovery/migrations`).

- Case states: open (released_at NULL) → released (terminal). Transitions happen under `lockOpenCase` (`SELECT … FOR UPDATE`, `ediscovery/repo.ts:96`); `markReleased` is a CAS (`repo.ts:101`).
- Hold rows are placed in the case's transaction (`ediscovery/service.ts:99-111`), narrowed (`:137-162`) and released (`:169-176`).
- Invariant: while any row names a board (or its owner in its workspace), nothing deletes it **and nothing destroys its content**. The DB trigger enforces the first half. Nothing enforces the second half (DATA-5).

#### DATA-M3. Case export job (`legal_case_exports.status`)

`pending → running → ready → expired`, `running → pending | failed`.

| from → to | trigger | guard | file:line |
|---|---|---|---|
| (none) → pending | request | `INSERT … WHERE NOT EXISTS pending/running` | ediscovery/repo.ts:162 |
| pending → running | job claim (attempts+1) | `FOR UPDATE SKIP LOCKED` plus job lock 7_202_611_311 | repo.ts:183 |
| running → ready | build done | `WHERE status='running'` | repo.ts:193 |
| running → pending/failed | build threw | `attempts >= max` → failed. **No `status='running'` guard** | repo.ts:207 |
| running → pending | `requeueStale` (started > 30 min ago) | **ignores attempts (DATA-2)** | repo.ts:211 |
| ready → expired | job; file deleted first | none needed | ediscovery/service.ts:303-306 |

#### DATA-M4. Data export job (`data_exports.status`)

This machine has the same shape as M3 (`privacy/repo.ts:45-126`, `privacy/service.ts:206-258`, job lock 7_202_610_302). It adds two things:

- orphan → row deleted, when the requester or workspace is gone (`filesToDrop`, `repo.ts:109`);
- `markFailed` is guarded by `status='running'` (`repo.ts:95`).

#### DATA-M5. Workspace key (`workspace_keys.state`, `workspace_data_keys`)

States: (none), active, suspended, unavailable, destroyed (`keys/migrations`). `current_version` only grows. A CHECK constraint ties `provider` to `kms_key_id`.

| from → to | trigger | guard | file:line |
|---|---|---|---|
| none → active | createKey | `INSERT … ON CONFLICT DO NOTHING` (409 once any row exists, destroyed included) | keys/repo.ts:71, service.ts:394 |
| active → active (v+1, maybe a new KEK) | rotateKey | `SELECT … state='active' FOR UPDATE`, version check, CAS per wrapped key | repo.ts:134, service.ts:414 |
| active/unavailable → suspended | admin | `UPDATE … WHERE state = ANY(from)` | repo.ts:173, service.ts:441 |
| suspended → active | admin resume after a probe | same CAS | service.ts:448 |
| active → unavailable | KMS refusal during an unwrap, or keys:check | same CAS | service.ts:111-133, 270, 295 |
| unavailable → active | keys:check probe ok | same CAS | service.ts:300 |
| any → destroyed | owner, after the name check and a legal-hold check | CAS plus `DELETE workspace_data_keys`. Terminal | service.ts:459-467 |

Caches per instance: `keyRows` and `deks` (cacheMs). They are invalidated through pubsub after every change (`forgetEverywhere`, service.ts:70).

#### DATA-M6. Seal state of stored content and files

- Board blobs: each row carries `sealed_with` (`<ws>:<version>` or NULL). `resealBoard` CAS-replaces them (`realtime/reseal.ts:15`, `realtime/repo.ts:540`).
- The keys:seal job only reseals boards of workspaces with an **active key** (`keys/service.ts:314`).
- Files: `uploads.workspace_id` and `sealed_with`, changed by `setSealing` CAS (`uploads/repo.ts:46`). `filesToReseal` also picks files sealed under a workspace that no longer governs them (`uploads/repo.ts:80`).

#### DATA-M7. Retention notice (implicit)

Fields: `retention_notice_at` versus last activity = `GREATEST(updated_at, created_at, max(board_opens))` (`boards/repo.ts:438`).

States:
- unwarned: notice NULL, or notice ≤ activity;
- warned: notice > activity;
- due: warned, notice ≤ now − 14 d, and activity ≤ cutoff.

Transitions: `markRetentionNoticed` (`repo.ts:476`) and `applyInactiveRule` (`repo.ts:491`). Edits, opens and unarchive count as activity and reset the board to unwarned. **Restore from trash does not (DATA-1).**

#### DATA-M8. Upload sweep

`uploads.last_referenced_at`: adopted → referenced → idle → deleted. Deletion re-checks the references just before deleting, all inside one transaction (`uploads/sweep.ts:89-112`).

#### Changes made by the fixes

These supersede the machine descriptions above where they differ.

- **Export jobs (M3, M4), #186:** the two machines are now the same. `running → failed` also on the stale requeue once `attempts ≥ 3`; `markReady`/`markFailed` are compare-and-set on `status = running AND attempts = <claimed attempt>`; the archive key is recorded at the first claim (`file_key = COALESCE(file_key, $key)`), so every written archive is named by its row; `fileDropped` replaces `markExpired` (`ready → expired`, `failed` stays `failed`, both clear `file_key`); downloads are allowed by `status = ready`, not by `file_key`. Archives are stored in the private storage area (S3 `private/`), and older ones are read from the public area until they expire.
- **Board lifecycle (M1, M7), #187:** `trashed → live` (restore) now sets `updated_at = GREATEST(updated_at, now)`, so it counts as activity: the retention clock restarts and the board is unwarned again, as after an edit, an open or unarchive. `trashed → gone` (purge) and `trashed → deleted` (`discardHeldExpired`) repeat their state conditions on the target row (`DELETE … USING` / `UPDATE … FROM`), so Postgres re-checks them on the latest row version under the lock; a board restored meanwhile is kept. "Delete forever" treats the held check as a fast path: a hold placed after it makes the `BEFORE DELETE` trigger refuse (FH001), which is caught, and the board takes the discard path, answered as done. New invariant: `discarded_at` is never set on a board whose `deleted_at` is NULL.
- **Legal holds and workspace keys (M2, M5), #188:** destroying a key and placing a hold take the same transaction lock (`lockLegalHolds`, a global advisory lock); `any → destroyed` counts holds under that lock in the same transaction as the update and the data-key delete, so a hold that commits first refuses the destroy (409 `legal_hold`) and one that comes second waits. `active → unavailable` (a KMS refusal, or the `keys:check` probe) is a compare-and-set on `state = active` plus the provider, the KMS key and the exact wrapped data key the refused unwrap tried; a stale cached row is dropped and retried once instead.
- **Seal state (M6), #188:** the `keys:seal` job also sweeps every board (1000 per round, resumable cursor) for rows sealed under a workspace other than the board's own, and reseals them for their current workspace (50 per round). With WORKSPACE_KEYS off and no keys the job returns at once. Rows sealed under a source key that has since been destroyed can't be resealed and are logged once per pass.

### Findings

#### DATA-1. A board its owner restored from the trash is trashed again by the next retention round — CONFIRMED

- Evidence:
  - `restoreFromTrash` (`boards/service.ts:993-1009`) and the admin's `restoreForWorkspace` (`:1134-1153`) call `repo.restoreBoard` (`boards/repo.ts:395`). It only clears `deleted_at` and `deleted_by`. It does not bump `updated_at` or clear `retention_notice_at`.
  - The board's last activity therefore stays old, and its notice is still newer than that activity and older than 14 days. `applyInactiveRule` (`repo.ts:491-499`) trashes it again in the next hourly round (`boards/init.ts:32-41`). No new notice is sent.
  - Compare unarchive, which bumps `updated_at` (`repo.ts:407`).
- Test: `boards/lifecycleAudit.test.ts` › "a board its owner restored from the trash after a retention rule trashed it is not trashed again by the next round". It fails at line 35 (`expected false to be true`): the board exists right after the restore and is gone after the next round.
- Impact: **High** likelihood for any workspace with a trash rule. Restoring is the one thing an owner does after the rule acts. The board bounces back to the trash within an hour, with no email, and its audit says "trashed by retention" again. Data is not lost (it is still in the trash), but the board can't be kept without also opening or editing it. Rating: Medium.
- Security-sensitive: no.
- Fix: make restore count as activity, as unarchive does. In `restoreBoard`, set `updated_at = GREATEST(updated_at, now)` (or clear `retention_notice_at`). The test above guards it.

#### DATA-2. Export jobs that crash their instance are retried forever (privacy and eDiscovery) — CONFIRMED

- Evidence:
  - `markFailed` is the only path to `failed`, and it runs only when the build throws (`privacy/service.ts:218-224`, `ediscovery/service.ts:321-324`).
  - A build that kills its process (OOM on a large workspace or case archive, a SIGKILL during a deploy) leaves the row `running`.
  - `requeueStale` (`privacy/repo.ts:101-103`, `ediscovery/repo.ts:211-213`) sets it back to `pending` regardless of `attempts`. `claimNext` hands it out again with `attempts+1` and never checks the maximum (`privacy/repo.ts:72-80`, `ediscovery/repo.ts:183-191`).
  - `insertExport` refuses new requests for that subject or case while it is pending or running, so the person can never get an export either.
- Tests:
  - `privacy/exportJobs.test.ts` › "an export whose build crashed its instance three times is not claimed a fourth time" fails with `expected { id: 'exp-crashing', … } to be null`.
  - `ediscovery/exportJobs.test.ts` › "a case export whose build crashed its instance three times is not claimed a fourth time" fails the same way.
- Additional (eDiscovery only): `markFailed` has no `AND status='running'` guard (`ediscovery/repo.ts:207-209`), unlike privacy's. If the job lock is ever lost mid-build, a late failure can overwrite a newer run's `running`/`ready` state. This is SUSPECTED and needs a lost advisory-lock connection.
- Impact: **Medium-High** when it happens. One oversized export crashes an instance every ~30 minutes (STALE_MS) indefinitely, and blocks that person's or workspace's exports for good. It is self-inflicted and reachable by any user who asks for an export of a big workspace.
- Security-sensitive: no (availability).
- Fix: have `requeueStale` apply the same rule as `markFailed`, i.e. `status = CASE WHEN attempts >= max THEN 'failed' ELSE 'pending' END`. Add `status='running'` to eDiscovery's `markFailed`. The two tests above guard it.

#### DATA-3. An export archive is left in storage forever when the build fails after the file is written — CONFIRMED (trace)

- Evidence:
  - privacy `build()` stores the ZIP (`privacy/service.ts:101`, `savePrivateFile`) and then calls `repo.markReady` (`:104`).
  - If `markReady` throws (a DB error or failover), the exception leaves `build`. The catch (`:221-223`) only calls `markFailed`; the `key` is never deleted. The same happens when the process dies between the two calls.
  - eDiscovery has the same shape (`ediscovery/service.ts:316-323`).
  - Nothing else ever deletes such a file:
    - `private-*.zip` keys are never adopted or swept by the uploads sweep (`uploads/private.ts:1-4`);
    - `filesToDrop` / `expiredFiles` only see keys recorded in rows.
- Impact: Medium. The file is a complete personal-data or case archive that outlives the person's deletion and the export TTL, contrary to the retention promise ("After that it is deleted"). Likelihood is low: it needs a DB error or crash at that instant.
- Security-sensitive: yes (personal data retained past its promised deletion).
- Fix: record the key before or with the upload (e.g. write `file_key` while `running` and let the drop/expire path delete it), or delete `key` in a `finally` when `markReady` didn't succeed. Regression test: make `markReady` fail once and assert the storage key is gone.

#### DATA-4. A KEK-changing rotation can mark the workspace's key `unavailable` from a stale cache — CONFIRMED (trace), transient

- Evidence:
  - `dataKeyOf` (`keys/service.ts:111-133`) takes the cached key row (`keyOf`, up to `cacheMs` old, `:99-106`) but reads the wrapped data key fresh from the DB (`:115`).
  - After `rotateKey` moved the workspace from the instance KEK to a KMS key, or from one KMS key to another (`:414-439`, `repo.rotate` rewrites every `wrapped`), the following can happen on another instance before the pubsub invalidation arrives, or on the same instance in a request that read `keyOf` before the commit:
    1. A DEK cache miss unwraps the new KMS-wrapped bytes with the old provider (`kekOf(key)`).
    2. `unwrapDataKey` throws `KeyRefusedError` (`keys/kek.ts:73,75`, or the provider's refusal).
    3. `markUnavailable` moves the key `active → unavailable` in the database (`:125`), for every instance.
  - It heals only when `keys:check` probes with a fresh row (`:295-305`, every cacheMs/2).
  - Meanwhile the whole workspace answers `key_unavailable` everywhere, `key.unavailable` / `key.available` audit events are written, and every board's derived plaintext (search) is re-derived to empty and back (`:252-268`).
- Impact: Low-Medium. Needs a KEK-changing rotation plus a DEK cache miss inside the invalidation window. The workspace-wide outage lasts up to cacheMs/2, with false audit noise.
- Security-sensitive: no (availability, audit integrity).
- Fix: never decide "refused" from a cached key row. On `KeyRefusedError`, re-read the key row and retry once with the current provider, or store the KEK ref per data key (`kek_ref` already exists) and unwrap with that. Regression test: cache the key row, rotate to a KMS key behind the cache, then open a board; the key must stay `active`.

#### DATA-5. Destroying a workspace key can shred content a legal hold placed concurrently keeps — CONFIRMED (trace)

- Evidence:
  - `destroyKey` checks `underLegalHold({ workspaceId })` (`keys/service.ts:463`), then in a separate transaction moves the key to `destroyed` and deletes every wrapped data key (`:464`, `keys/repo.ts:181-189`). Nothing locks between the two.
  - `createCase` / `changeCase` commit hold rows in their own transaction (`ediscovery/service.ts:99-111`, `:137-162`).
  - Interleaving:
    1. destroy reads "no hold";
    2. the case commits a hold on boards of that workspace;
    3. destroy commits.
  - The held boards' content is now unreadable for good.
  - The board-deletion invariant has a DB trigger. Crypto-shredding is the one destruction path with no database guard, and it is irreversible.
- Impact: Medium. Spoliation of held evidence, but it needs an owner destroying while a case manager places a hold in the same instant.
- Security-sensitive: yes (legal-hold integrity).
- Fix: take a lock both paths share, e.g. a `FOR UPDATE` on the workspace row, or check the hold inside `setState`'s transaction with `SELECT … FROM board_owner_legal_holds/board_legal_holds … FOR SHARE`, and have `placeLegalHold` lock the same row. Regression test: a hold placed between the check and the state change refuses the destroy. Inject this with a hold check that places the hold.

#### DATA-6. "Delete forever" racing a new hold answers 500 and reveals the hold — CONFIRMED (trace)

- Evidence:
  - `deleteForever` checks `heldAmong` in one transaction (`boards/service.ts:1161-1166`) and deletes in a second (`:1171-1176`).
  - If a hold commits in between, the `BEFORE DELETE` trigger raises `FH001`. Nothing maps it: `isLegalHoldViolation` (`boards/repo.ts:601`) has no caller. The owner gets a 500.
  - `docs/design/compliance.md` ("Silence"; table row "Delete forever … Answers as if done") promises that the board is discarded silently.
- Impact: Low. The data is safe, but an unexpected error tells the custodian something changed at that moment. It is rare.
- Security-sensitive: yes (minor: hold silence).
- Fix: do the held check and the delete-or-discard in ONE transaction that locks the board row (`SELECT … FOR UPDATE`, then held → discard, else delete), or catch `isLegalHoldViolation` and fall back to `discardTrashedBoard`. Regression test: inject a hold between the check and the delete and assert the board ends up discarded with a 204.

#### DATA-7. The trash purge can delete a board restored while the purge waits on its row — SUSPECTED

- Evidence:
  - `purgeTrashedBefore` is `DELETE FROM boards WHERE id IN (SELECT b.id … WHERE b.deleted_at < cutoff … AND NOT HELD … LIMIT n)` (`boards/repo.ts:556-569`). All the state conditions are in the sub-select.
  - Under READ COMMITTED, if `restoreBoard` (`repo.ts:395`) holds the row lock and commits after the purge's snapshot, Postgres's EvalPlanQual re-checks only the join to the sub-select's original output. It does not re-check `deleted_at`, so the freshly restored (live) board is deleted.
  - The restore has already audited `board.restored` and returned 200.
  - This can't be reproduced on single-connection PGlite.
- Impact: Medium if it happens (a board the owner just restored is lost), but very rare. It needs a restore at the same moment the hourly purge reaches that board.
- Security-sensitive: no.
- Fix: put the state conditions on the target row too: `DELETE FROM boards b WHERE b.id IN (…) AND b.deleted_at IS NOT NULL AND b.removed_at IS NULL`, so EPQ re-evaluates them. Or lock candidates with `FOR UPDATE SKIP LOCKED` in the sub-select. Regression test: a two-connection Postgres test (`DATABASE_URL`) racing restore against purge.

#### DATA-8. A board moved into a workspace without a key can keep rows sealed under the source's key, and no job repairs them — CONFIRMED (trace), needs a failed post-move reseal

- Evidence:
  - `moveToWorkspace` reseals for the target (`boards/service.ts:856`), commits the move, and reseals again for saves made in between (`:885`). That second reseal only logs on failure.
  - Rows the open room saved in that window are sealed with the source key (`realtime/sealing.ts:44-46` resolves the board's workspace at save time).
  - The repair job `sealPendingContent` iterates only workspaces with an **active key** (`keys/service.ts:314`). A board now in an unkeyed workspace is never looked at. Uploads, by contrast, do handle this case (`uploads/repo.ts:80-93`, "sealed under another workspace's key").
  - Doc and update rows heal on the next compaction, but version snapshots and layer rows stay under the source key. The board in its new home then depends on the old workspace's key: suspending, destroying or deleting the source workspace makes those versions (or the board) unreadable.
- Impact: Low. It needs the second reseal to fail (the source key changing state, or a DB error) right after a move.
- Security-sensitive: no.
- Fix: have the keys:seal job also look for boards whose rows name another workspace's key than the board's current one (as `filesToReseal` does), whatever the target's key state. Regression test: move with the post-move reseal forced to fail, then run the job, and every row is sealed with the target's ref or is plain.

#### DATA-9. Export archives are stored in the public storage area — CONFIRMED (code)
- Evidence: `uploads/private.ts:15-19`: `savePrivateFile` stores personal-data and case export ZIPs with `storage().put(key, data, "application/zip")`, i.e. the default public area (S3 `uploads/`, which `S3_PUBLIC_URL` may expose), unlike `savePrivateImage` (`PRIVATE_AREA`, S3 `private/`). They are never served at /uploads (the key pattern), and the keys are 32 random characters.
- Impact: Low–Medium. An archive of someone’s personal data sits under a prefix a deployment may publish; reachable only with the exact key. Rating: Low–Medium.
- Security-sensitive: yes (confidentiality of exports), low exploitability.
- Fix: store, read and delete export archives in the private area, reading old ones from the public area until they expire. Found by the #186 fixer.

### Checked and fine

- **Double trash, archive, restore, takedown:** every lifecycle UPDATE is a CAS on the state column (`trashBoard` `deleted_at IS NULL`, `restoreBoard`, `setArchived`, `setRemoved`, `setLinkBlocked`, `discardTrashedBoard`). A retried or doubled request returns false and audits nothing (`boards/repo.ts:208-224, 390-411, 679`).
- **Restore by the owner and an admin at once:** the second CAS fails → 404. The quota is checked under `lockOwnerQuota` inside the same transaction (`boards/service.ts:696-704`).
- **Purge on several instances:** `runExclusive` plus the scheduled job's advisory lock. A batch that hits the hold trigger rolls back as a whole and is retried next round. `discardHeldExpired` runs before the purge in the same round.
- **Hold placed while the purge runs:** the sub-select's `NOT HELD` may be stale, but the `BEFORE DELETE` trigger re-reads the holds per row and the batch fails safe.
- **Held board leaving a custodian** (transfer, hand-over, move): the trigger copies the custodian's holds onto the board with `via_owner` before the owner or workspace changes. Narrowing a custodian removes those rows. An explicit pick overrides `via_owner` (`ON CONFLICT … SET via_owner = NULL`).
- **Retention rule versus an open/edit at the same moment:** `applyInactiveRule` re-checks inactivity, notice age and workspace in the UPDATE's WHERE. A board moved to another workspace is left alone.
- **Takedown versus trash at the same time:** the board can carry both stamps. The trash list, purge and restore all exclude `removed_at`, and an operator restore returns it to the trash. Note: its original `deleted_at` is kept, so if the trash period ran out during review, the next purge deletes it. This is consistent with the owner having trashed it.
- **Account purge versus holds:** it checks `underLegalHold` before the hand-over. `deleteAllOwnedBy` excludes `HELD`. A hold appearing later makes the user delete fail on the trigger, and the next run waits (`accounts/purge.ts:41-55`).
- **Export claim on two instances:** `FOR UPDATE SKIP LOCKED` plus the job lock. `markReady` is guarded by `status='running'`, and a lost race deletes its own file. A ready export is never downgraded by privacy's guarded `markFailed`.
- **Double export request:** a single `INSERT … WHERE NOT EXISTS (pending|running)` (`privacy/repo.ts:45`, `ediscovery/repo.ts:162`).
- **Expiry of a running export:** expiry looks only at `status='ready' AND expires_at <= now`, so a running build is never expired. Download re-checks `expires_at` (`privacy/service.ts:193`, `ediscovery/service.ts:293`).
- **Case release versus change:** both run under `lockOpenCase … FOR UPDATE`, and `markReleased` is a CAS.
- **Key rotation versus rotation or destroy:** `rotate` locks the active row `FOR UPDATE`, checks `current_version + 1`, and CAS-rewraps each data key. Destroy commits first → rotate returns false → 409.
- **Instance-secret rewrap versus rotation:** both CAS on `wrapped`. The loser retries next run, or answers 500 / "try again".
- **Suspend or destroy while boards are open:** pubsub drops caches. Suspend keeps the in-memory DEK so last saves still seal. Destroy drops DEKs, so later saves fail closed (never plaintext). The `blocked` rule reads the state from the DB every time (`unusableKeysAmong`).
- **WORKSPACE_KEYS turned off after keys exist:** `keysInUse()` falls back to `anyKeyInUse()`, which counts destroyed keys. The cached `false` can only exist while no key row exists, and keys can't be created while off.
- **KMS unreachable mid-reseal (boards):** `resealBoard` opens and seals everything before one transaction of CAS updates, so a failure changes nothing. Move refuses with 403 when either key can't be used (`boards/service.ts:856`).
- **KMS unreachable mid-reseal (files):** `resealFile` returns `waiting`. A stored object names its key in its own header, so a put that succeeded with a failed row CAS still reads correctly.
- **Upload sweep versus a new reference:** the references are re-checked right before deletion, and the delete and file removal happen in one transaction. Private export ZIPs and private images never match `FILE_NAME_RE`.
- **Operator delete of a taken-down board while held:** 409 before the delete, and `NOT HELD` in the statement.

## Realtime collaboration and client sync (RT)

### Machines

#### RT-M1. Room lifecycle (server, one per board/doc id per instance)

Lives in module state `rooms: Map<string, Room>` (rooms.ts:1541) and the `Room` fields `destroyed`, `pendingJoins`, `conns`, `dirty`, `pendingSaves`, `unloadTimer` (rooms.ts:378-418).

States (implicit):

| State | Representation |
|---|---|
| absent | no `rooms` entry |
| loading | entry exists, `ready` pending (`open()`: subscribe, then `load()`, rooms.ts:493-524) |
| live | `ready` resolved, `conns.size > 0` or `pendingJoins > 0` |
| idle | live with no conns and no pendingJoins; `unloadTimer` armed (`scheduleUnload`, rooms.ts:1516) |
| unloading | `unloadRoom` running (flush, then saveMissing) (rooms.ts:1568-1585) |
| closed | `closeBoardHere`: removed from `rooms`, sockets closed, final flush, then destroyed (rooms.ts:2152-2163) |
| dropped | `dropRoom`, after `BoardGoneError` in persist (rooms.ts:1456-1459, 1562) |
| destroyed | `destroyed = true` (terminal, rooms.ts:1522-1533) |

Invariants:

- At most one non-destroyed Room per id in `rooms`, and the doc is loaded once.
- No Room is destroyed while it holds unsaved writes, unless the board is gone.
- No socket is attached to a Room that is destroyed or no longer in `rooms`.
- Every socket in `conns` holds a role its user currently has (see M3).

| from → to | trigger | guard | file:line |
|---|---|---|---|
| absent → loading | `getRoom` (socket admission, `withLiveRoom`) | none | rooms.ts:1547 |
| loading → absent+destroyed | load rejects | `rooms.get(id)===created` | rooms.ts:1552-1556 |
| loading → live | `ready` resolves, `join` | `ws.readyState===OPEN`, `!room.destroyed` | rooms.ts:1633-1644 |
| live → idle | last `leave` | `conns.size===0` → flush + scheduleUnload | rooms.ts:1340-1350 |
| idle → live | `join` clears `unloadTimer` | — | rooms.ts:1062 |
| idle → unloading → destroyed | `unloadTimer` | `idle()` re-checked after every await; `hasPendingWrites` / `saveMissing` failure → reschedule | rooms.ts:1568-1585 |
| any → closed → destroyed | `closeBoardDoc` (delete, trash, takedown), control `close-board` / `remove-board` | none (also no access epoch bump, see RT-1c) | rooms.ts:2147-2163 |
| live → dropped | persist hits `BoardGoneError` | — | rooms.ts:1456 |

Retries: `flush()` is queued, so a second flush runs after the first. A failed persist re-queues `unsaved` at the front and re-arms a 5 s retry (rooms.ts:1452-1467).

#### RT-M2. Save queue / persistence of one room

Fields: `dirty`, `unsaved[]`, per-layer `unsaved[]`, `saving` promise chain, `pendingSaves`, `saveTimer`, `logRows/logBytes` (rooms.ts:389-400, 1399-1480). In the DB: `board_docs` (base + `version`), `board_doc_updates` (log), `board_doc_snapshots` (repo.ts).

States: clean → dirty (debounce 1.5 s, max wait 10 s) → saving → clean | dirty (failed, retry in 5 s). Compaction is a sub-step and runs when the log reaches 200 rows or 2 MB.

Invariants:

- A change applied to the live doc reaches the log, or is still in `unsaved`.
- A compaction never drops rows it did not fold.

| from → to | trigger | guard | file:line |
|---|---|---|---|
| clean → dirty | doc/layer `update` with origin ≠ LOAD/REMOTE | `!destroyed` | rooms.ts:424-439, 608-622, 1399 |
| dirty → saving | `saveTimer` / `flush()` | `dirty && !destroyed` | rooms.ts:1419-1428 |
| saving → clean | append ok (+touchBoard, layer appends) | — | rooms.ts:1438-1451 |
| saving → dirty | any append throws | updates re-queued in order | rooms.ts:1452-1467 |
| (DB) base vN → vN+1 | compactDoc | `version === fromVersion` under `FOR UPDATE` | repo.ts `compact` |
| (DB) base replaced | saveInitialState (duplicate, trash keep-content) | bumps `version`, so a racing compaction skips | repo.ts `saveInitialState` |

#### RT-M3. Socket admission and effective role (server)

Steps (rooms.ts:1607-1654):

1. upgraded and queueing
2. authorize (ws.ts:44-87: session, rate limit, `getBoardAccess`, then `authorNamesOf`)
3. the epoch is read
4. waits for the room's `ready`
5. joined
6. if the epoch moved, refresh

After that, the joined socket's `access/ownAccess/role/readRole/limits/participant/guestGrant` fields (rooms.ts:241-300) are re-derived by `refreshAccess` (rooms.ts:1362-1397) and `setEffective` (rooms.ts:813-844).

Terminal: closed with 4401 (session ended, rooms.ts:1335 / 1692), 4403 (access revoked, rooms.ts:1388; or board deleted, rooms.ts:1642, 2157), `WS_CLOSE_BOARD_REMOVED`, 1009 (too large, rooms.ts:1256 / 1617), 1011 (load failed, rooms.ts:1649).

Invariants:

- A joined socket's `access` equals `capRole(currentRole, maxRole)` as of the last committed access change.
- A user with no role has no socket.

| from → to | trigger | guard | file:line |
|---|---|---|---|
| authorizing → refused | `Refusal` | — | rooms.ts:1628 |
| authorizing → joined | role resolved | epoch read AFTER authorize (RT-1) | rooms.ts:1626-1646 |
| joined → joined' | `refresh-access` (local or control channel) | per-board epoch bump + `refreshAccess` (serialized) | rooms.ts:1709-1721, 1734 |
| joined → closed 4403 | refresh resolves null | the refresh must succeed (RT-2) | rooms.ts:1386-1389 |
| joined → closed 4401 | session end | — | rooms.ts:1690-1693 |
| joined (role X) → joined (effective Y) | facilitation map changes, any instance | — | rooms.ts:479, 805-844 |

#### RT-M4. Client connection status (`ConnectionStatus`)

Type: `'local' | 'connecting' | 'connected' | 'disconnected' | 'denied' | 'removed'` (apps/web/src/engine/store/BoardStore.ts:57; also used by ObjectDocStore.ts). There is also the derived `LiveBoardStatus` `'connecting'|'ready'|'denied'|'removed'|'missing'` (engine/canvas/LiveBoardView.tsx:17, 75-78).

Invariants:

- 'denied' and 'removed' are terminal (no reconnect, read-only, device copy forgotten).
- Every other server refusal is retried with backoff.

| from → to | trigger | file:line |
|---|---|---|
| (ctor) → local | no syncUrl | BoardStore.ts:298-303 |
| (ctor) → connecting | syncUrl; connect after device copy load | BoardStore.ts:200-227 |
| connecting ↔ connected ↔ disconnected | y-websocket `status` | BoardStore.ts:268-273 |
| any → denied / removed | close 4401/4403/EMBED_FULL / REMOVED: `shouldConnect=false`, role→viewer, `dropPersisted` | BoardStore.ts:280-297 |
| connected → disconnected → connected (100 ms) | any other server close after the upgrade (1009, 1011, 4429) | y-websocket.js:135-167, 196-200 (RT-5) |

Edits while disconnected are local Yjs updates. They are sent by the step-1/2 exchange on reconnect (layers via `requestLayerSync`, BoardStore.ts:269). Layer ops are queued in `pendingOps` and sent after the next sync (BoardStore.ts:441-456).

#### RT-M5. Suggestion record (editors layer `suggestions`)

Type: `SuggestionState 'ready'|'changed'|'gone'` (packages/shared suggestions.ts; `suggestionState`). Decision: absent (pending) | `{status:'accepted'|'rejected', by, at, forced?, withdrawn?}`. Records are pruned 24 h after a decision (`DECIDED_SUGGESTION_TTL_MS`, `pruneDecided` on load, suggestions.ts:252-266).

Invariants:

- Only the server creates records.
- A socket may only set a pending record's decision to one naming itself, or clear its own decision.
- **accepted ⇔ the proposed change was applied; rejected ⇒ the proposed change was not applied by this decision.**
- A pending record from a revoked credential is withdrawn (KAI-224).

| from → to | trigger | guard | file:line |
|---|---|---|---|
| ∅ → pending | `proposeSuggestions` (API/MCP/AI) | `requireEditing`, `MAX_PENDING_SUGGESTIONS` | rooms.ts:1855-1881, suggestions.ts:84-127 |
| pending → accepted | socket (`Editor.acceptSuggestions`: shared-doc write + decision, **two docs, two messages**) | `guardSuggestionWrites` on the layer only | EditorImpl.ts:1809-1853, rooms.ts:750-754 |
| pending → accepted | API `decideSuggestions` | `planDecision` (pending only; stale unless `force`), applyChange + writeDecisions in one sync step | rooms.ts:1900-1921, suggestions.ts:147-195 |
| pending → rejected | socket / API | same guards | EditorImpl.ts:1855-1868 |
| pending → rejected(withdrawn) | credential revoked → outbox → `withdrawSuggestionsOn` | hint table `board_suggestion_authors` | rooms.ts:1945-1968, withdrawals.ts |
| decided(by me) → pending | socket undo | `from.by === userId` | suggestions.ts:220-231 |
| decided → decided' | socket | refused (reverted) | suggestions.ts:229 |
| decided → ∅ | load after 24 h | — | rooms.ts:515-516 |

Retries: an API accept/reject retried → `SuggestionNotFoundError` (not pending). A socket accepting twice: the client only offers pending ones.

#### RT-M6. Undo history across docs (client)

`UndoHistory` steps over one `Y.UndoManager` per doc (shared, private, editors) (apps/web/src/engine/store/undo.ts). Step = set of managers that got a stack item inside one `beginStep/endStep`.

Invariant: one Undo reverts exactly one user action, in every doc it wrote, or nothing.

| from → to | trigger | file:line |
|---|---|---|
| open step → recorded | `stack-item-added` while open | undo.ts:42-56 |
| undoSteps top → redoSteps | `undo()`: `m.undo()` on every manager of the step | undo.ts:84-104 |
| — | `Y.UndoManager.undo()` pops **until a change is performed** (yjs 13.6.33 `popStackItem` loop), so it can consume an item belonging to an older step (RT-4) | node_modules/yjs/dist/yjs.cjs ~3517-3565 |

#### RT-M7. Access-scoped layer copy on the client (editors layer)

The editors layer doc is held only while `readRole ≥ editor`. Losing the role should reset it (`resetLayer`), and gaining it requests a sync (apps/web/src/engine/runtime/core.ts:230-236).

Invariant (stated in the comment there): "Hidden frames' contents and pending suggestions: only owners/editors may hold them. Losing the role forgets the local copy."

The guard is `if (store.layers.editors.elements.size)`, so it only fires when the layer holds elements (RT-6).

#### RT-M8. Device (offline) copy (#178)

Vault records in IndexedDB `freero-offline` (apps/web/src/app/offline/vault.ts, copies.ts). States per board: none → kept (saved after the first sync / every 800 ms) → forgotten (terminal close, 403/404/451, offline-check, policy, sign-out wipe). Vault operations are serialized (`serial`, vault.ts:64-66). Saves are fenced by `generation` (copies.ts:86-101).

#### RT-M9. Cross-instance board channel and control channel

Peer messages: `update`, `awareness`, `sync-request`, `sync-reply`, `layer-update` (peers.ts). Control messages: `refresh-access`, `close-board`, `remove-board`, `refresh-profile`. Delivery is fire-and-forget (`publish`, platform/pubsub.ts:147-157). On reconnect, `resubscribed` makes each room *pull* (`requestPeerSync`, rooms.ts:496, 928-931). The control channel has no catch-up at all (rooms.ts:1724-1742).

#### RT-M10. Follow (presence)

`ui.following` set by `Editor.follow`. It ends when no tab of the followed user is in awareness (camera/follow.ts:35-51), unless `locked`.

---

#### Changes made by the fixes

These supersede the machine descriptions above where they differ.

- **Undo history across docs (M6), #198:** a step now holds its own stack items per undo manager (recorded from `stack-item-added`); undo, redo and cancelling a gesture pop exactly those, top first, each with a one-item stack, so a no-op item can never fall through to an older step. A manager's part counts only while its items are still on top of that manager's stack. If a collaborator has overwritten all of the top step, one Undo (or Redo) consumes it, changes nothing and pushes nothing to the other history; if only part was overwritten, the rest is taken back. We no longer rely on `Y.UndoManager.undo()` popping until something changes.
- **Socket admission and room lifecycle (M1, M3):** a per-board access version (`accessVersion` / `accessChangedAt`) is read before `authorize()` and bumped by every access refresh and by `closeBoardHere` (delete, trash, takedown, control close/remove), also when the room isn't loaded on this instance. `authorizing → joined` requires that nothing changed after that read and the room is current; otherwise the socket re-reads its access (→ 4403 / 4451 if it is gone, else loop; → 1013 after 3 re-reads). A failed refresh read leaves the role unchanged and is retried (1 s doubling to 60 s); every open socket is re-checked every 5 min (`ACCESS_RECHECK_MS`) and when the control channel resubscribes. Invariant: a socket never joins with a role that ended before it joined, and a missed revocation is repaired within 5 minutes.
- **Editors layer on the client (M7):** losing the editor role resets the layer whenever its doc ever received anything (suggestions included), not only when it holds elements.
- **Suggestion author hints (M5, M9):** hints carry `noted_at` (upserted on each proposal); clean-up from a room load or a withdrawal never deletes a hint noted in the last hour, so a revoked app's suggestions are still found.
- **Suggestion record (M5), #200:** accept and reject are a compare-and-set on the decision: whichever reaches the server first stands. Invariant now enforced: accepted ⇔ applied. An accept that arrives after a rejection has its board change undone in the same transaction (live) or by a server change once it arrives from offline (only where nobody changed the item since); a new item under a rejected suggestion's id is undone in any order.
- **Room lifecycle and save queue (M1, M2), #200:** a request's change is either saved or its request fails: `Room.saveNow()` throws `BoardClosedError` (API 409 `board_closed`) when the room was destroyed with the change unsaved, and a closing room saves in up to 3 rounds.
- **Client connection status (M4), #199:** a socket the server closes within 30 s of opening (4429, 1011, 1013) is retried with backoff (0.25–0.5 s doubling to 30 s, jitter), reset only after 30 s open. New terminal state `refused` (1009): the tab goes read-only, forgets its device copy and says why.
- **Cross-instance channel (M9), #199:** resync is two-way: after answering a `sync-request`, an instance that lacks something the asker holds asks back.
- **Follow (M10), #199:** a missing followed person ends following only once this tab's own presence is settled (connected, synced, and 3 s after it is live again); an audience follows the presenter while the server's presentation session still names them.

### Findings

#### RT-1. A socket admitted while access is ending joins with the role it had (removal, trash, takedown)

- **Status: CONFIRMED.** Failing tests in `apps/server/src/modules/realtime/accessRace.test.ts`:
  - "a member removed while their socket is being admitted is not let in with the role they had" → `expected 'open' to be 4403`.
  - "a board closed for everyone (trashed, taken down) while a socket is being admitted does not keep that socket in a fresh room" → `expected 'open' not to be 'open'`.
- **Evidence:**
  - Member removal. `admitSocket` reads the per-board access epoch *after* `await authorize()` (rooms.ts:1626-1629). The real authorize reads the role (ws.ts:67, `getBoardAccess`) and then awaits one more DB call (`authorNamesOf`, ws.ts:83). The interleaving:
    1. authorize reads role = editor.
    2. The removal commits, and `refreshRoomAccess` → `refreshAccessHere` bumps the epoch (rooms.ts:1710) and refreshes the room, which does not contain the socket yet.
    3. authorize returns, and the epoch is read already bumped.
    4. The socket joins.
    5. `epoch !== current` is false (rooms.ts:1646), so there is no re-check.

    The socket stays an editor until some later access change on that board.
  - Trash / takedown. `closeKeepingContent` (boards/service.ts:984-990) → `closeBoardDoc` → `closeBoardHere` removes the room from `rooms` (rooms.ts:2155). It does not bump `accessEpochs`. A socket whose authorize already passed then calls `getRoom` → a fresh Room is loaded from the DB → it joins and keeps editing a trashed or taken-down board. Its writes are saved, because the board row still exists. A deleted board self-heals: the next save throws `BoardGoneError` → `dropRoom`.
- **Impact: Medium.** A removed member, or someone on a board taken down for review, keeps live edit/read access until they disconnect. The window is one DB round trip, but it is hit whenever a removal or trash coincides with a (re)connect, for example a reconnect storm after a deploy. Edits to a trashed board after its content snapshot are kept, because log rows merge with the snapshot.
- **Security-sensitive: yes.**
- **Suggested fix:** Read the epoch before `authorize()` starts, keyed on the board id parsed from the URL, or keep a global counter. Bump it in `closeBoardHere` too. Better still, have `join` re-check "room still current and not closed" and run one refresh after join whenever the epoch moved since before authorize. Regression tests: the two above.

#### RT-2. Access revocation is one-shot: a refresh that fails, or a lost control message, leaves a removed member connected

- **Status: CONFIRMED** for the DB-failure path. Failing test "a removed member's open socket is closed even when the access refresh hits a database error once" (accessRace.test.ts) → `expected 'open' to be 4403`. The lost-control-message path is CONFIRMED by trace.
- **Evidence:**
  - `doRefreshAccess` resolves every socket with `Promise.all` (rooms.ts:1372-1381). One rejected read (DB blip, pool timeout) rejects the whole refresh. `refreshAccess` only logs it (rooms.ts:1367). Nothing retries, and no periodic re-check exists for board access. Sessions do have `recheckLiveSessions`, but board roles do not.
  - The `refresh-access` control message is published fire-and-forget (rooms.ts:1680-1684, pubsub.ts:147-157). The control channel subscriber has no `resubscribed` catch-up (rooms.ts:1725-1740). An instance that misses it (Redis gap, publisher reconnecting) keeps the old roles for good.
- **Impact: Medium.** Every socket on that board keeps its old role (also after demotions), until that person reconnects or some later access change succeeds. Likelihood is low per removal, but the failure is silent.
- **Security-sensitive: yes.**
- **Suggested fix:** Use `Promise.allSettled` and retry failed sockets with backoff, closing on repeated failure. Add a periodic re-check of live board sockets, like `recheckLiveSessions` (for example every N minutes per room, or on control-channel `resubscribed`). Regression test: the one above, plus a "control message missed → periodic recheck closes" test.

#### RT-3. One editor rejects while another accepts the same suggestion → the record says rejected and the change is on the board

- **Status: CONFIRMED.** Failing test `apps/server/src/modules/realtime/suggestionRace.test.ts` "one editor rejecting a suggestion while another accepts it never leaves it rejected with its sticky on the board" → `expected { status: 'rejected', onBoard: true } to not deeply equal …`.
- **Evidence:** A socket accept is two independent messages: the shared-doc write (the new sticky) and the editors-layer decision (EditorImpl.ts:1839-1851; BoardStore.transactAll writes two Y.Docs, each sent separately). The server guards only the layer message (`guardSuggestionWrites`, rooms.ts:750-754): "decided → decided differently" is reverted (suggestions.ts:229). The shared-doc message is applied as an ordinary editor write (rooms.ts:1177-1204) with no link to the suggestion. When Ann's reject reaches the server first, Bob's accepted-decision is reverted but his sticky is kept. The same happens for an API `decideSuggestions` reject (rooms.ts:1900-1921) racing a socket accept.
- **Impact: Low–Medium.** The board ends up with content whose suggestion says "rejected". Bob's UI shows it rejected, and his own undo then only removes the sticky. #82 consumers (`onSuggestionsDecided`, the trackers linking accepted imports) never hear "accepted" for content that is on the board. This needs two reviewers acting within one round trip.
- **Security-sensitive: no.**
- **Suggested fix:** Make the server decide which accept wins. Either have the socket send only the decision and let the server apply the change for an accepted record in the same step (as `decideSuggestions` does), or have the shared-doc guard revert elements whose `suggestedBy` record is not accepted by that socket. Regression test: the one above.

#### RT-4. Undo after a collaborator overwrote my last edit takes back half of an earlier two-doc action, and the dragged sticky disappears for everyone

- **Status: CONFIRMED.** Failing test `apps/web/src/engine/__tests__/undoAcrossRemote.test.ts` "undo after a collaborator overwrote my last edit never deletes the sticky I dragged out of a hidden frame before it" → `expected undefined to be defined`. A control run without the remote overwrite passes.
- **Evidence:**
  - `UndoHistory.replay` pops the top step S2 = {shared} and calls `m.undo()` (undo.ts:94-104).
  - `Y.UndoManager.undo()` keeps popping stack items until one performs a change (yjs `popStackItem` loop). S2's item does nothing, because its key was overwritten remotely, so the shared manager goes on and undoes S1's shared item. That item is the `set` of the sticky dragged out of the hidden frame, so the undo deletes it from the shared doc.
  - S1's editors-layer item (the delete from the editors layer) is not undone, so the sticky is in no doc. It is gone from the board and the delete syncs to everyone.
  - S1 stays on `undoSteps` with a manager whose items now belong to other steps, so later undos keep pairing the wrong items.
- **Impact: Medium.** An item silently disappears for all collaborators after one Ctrl+Z. It comes back only if the user presses Undo again. It happens whenever someone edits the same item you edited last, after a multi-doc action: hidden frames, private drafts, suggestion accept/reject, which spans shared + editors. A single-doc variant skips the no-op step and undoes the previous one.
- **Security-sensitive: no.**
- **Suggested fix:** Make one history step pop exactly the stack items it recorded. Record the `StackItem` references per manager in the step, and when a manager's top item is not the step's item, pop and drop no-op items yourself rather than calling `m.undo()` blindly. If one doc's part can't be undone, skip the whole step consistently. Regression test: the one above.

#### RT-5. A server close after the upgrade (1009 too large, 4429 too many connections, 1011 load failed) puts the client in a ~100 ms reconnect loop

- **Status: CONFIRMED.** Failing test `apps/server/src/modules/realtime/guestOversize.test.ts` "a guest whose change is too large is not reconnected and closed again and again" → `expected 28 to be less than or equal to 1` (28 closes in 3 s).
- **Evidence:**
  - The server accepts the WebSocket upgrade and refuses later. 1009 comes from `onGuestUpdate` (rooms.ts:1255-1258) and from the pre-join queue (rooms.ts:1617). 4429 comes from the rate limit (ws.ts:60). 1011 comes from a load failure (rooms.ts:1649).
  - y-websocket's `onopen` resets `wsUnsuccessfulReconnects = 0` (y-websocket.js:196-200). On close it reconnects after `2^0 * 100 ms` (y-websocket.js:158-166). BoardStore treats only 4401/4403/REMOVED/EMBED_FULL as terminal (BoardStore.ts:281).
  - For an oversized guest change, every reconnect re-sends the same change in sync step 2, so the loop never ends and nothing else that guest writes lands.
  - For 4429, the loop keeps the per-user limiter tripped. The ws.ts comment says "the client retries with backoff", but it doesn't.
  - For 1011 during a DB outage, every open tab re-authenticates against the DB about 10 times a second.
- **Impact: Medium.** It causes a stuck client: the guest sees "connected/disconnected" flicker forever and later edits are lost. It also puts self-inflicted load on the DB and Redis exactly when they are struggling. The guest case is reachable by pasting more than 256 KB of text into a sticky (no client-side cap).
- **Security-sensitive: no.**
- **Suggested fix:** Refuse before the upgrade where possible (rate limit). For close codes the server means as "slow down" or "this change is refused", have BoardStore/ObjectDocStore apply their own backoff, or make 1009 terminal with a message. Guest editors should have a client-side size check before writing. Regression test: the one above, plus one with 4429 asserting a growing delay.

#### RT-6. A person demoted below editor keeps (and keeps seeing) pending suggestions when the board has no hidden items

- **Status: CONFIRMED.** Failing test `apps/web/src/engine/__tests__/demotedSuggestions.test.ts` "someone made a commenter no longer holds the pending suggestions of a board without hidden frames" → `expected [ … ] to have a length of +0 but got 1`.
- **Evidence:** On a role drop, core.ts:233-234 resets the editors layer only `if (store.layers.editors.elements.size)`. Suggestions live in that layer's `suggestions` map, not in `elements`. The panel still lists them read-only for non-editors ("youCanReviewTheseHere", features/suggestions/panel.tsx:201-213), along with canvas ghosts. After the demotion the server stops sending that layer, so the copy goes stale and stays frozen.
- **Impact: Low.** No new data leaks (the server sends no more), but it breaks the rule "a viewer, commenter or guest never holds a suggestion", and the commenter sees stale proposals.
- **Security-sensitive: yes** (access-scoped data kept after access loss), low severity.
- **Suggested fix:** Reset the editors layer on any role drop below editor when the doc holds anything (`doc.share` non-empty), not only elements. Regression test: the one above.

#### RT-7. A Redis outage on one instance's publishing side leaves the other instances' copies behind for the room's lifetime

- **Status: CONFIRMED by trace** (needs an asymmetric Redis disconnect, not reproducible on PGlite or in-memory pubsub).
- **Evidence:**
  - `publish` drops messages while the connection is down (pubsub.ts:147-157).
  - When instance A's publisher reconnects, `catchUpAfterReconnect` → `notifyResubscribed` → A's rooms `requestPeerSync` (rooms.ts:496, 928-931). That only *pulls*: instance B answers with what A lacks (`answerPeer`, rooms.ts:1020-1035) and never asks A for what B lacks.
  - A's socket edits made during the gap were saved by A but never relayed, so B's sockets don't see them. B's later integration of A's newer updates may also stay pending on missing dependencies.
  - The gap persists until B's room unloads and reloads, which needs B to have zero sockets.
  - Control messages lost in the same gap are covered by RT-2.
- **Impact: Medium** (multi-instance only). Collaborators on different instances see different boards with no error until everyone on B leaves. Nothing is lost in the DB.
- **Security-sensitive: no.**
- **Suggested fix:** Make `sync-request` symmetric: the receiver compares the requester's state vector and, if the requester has more, sends its own `sync-request` back. Or have a resubscribing instance also publish `Y.encodeStateAsUpdate` diffs against the others' replies. Regression test: two rooms on a fake pubsub that drops one side's publishes, then reconnects and expects convergence.

#### RT-8. A request write that lands while its board is being trashed is reported as saved but lost

- **Status: CONFIRMED by trace.** No test written: it needs a held DB save.
- **Evidence:**
  - `closeBoardHere` removes the room, closes sockets and awaits `room.flush()` (P_A, rooms.ts:2161).
  - A `changeBoard` / `proposeSuggestions` / `decideSuggestions` already inside `withLiveRoom` (past the `destroyed` checks, rooms.ts:1758, 1827) applies its change while P_A's persist is in flight, then awaits its own `flush()` (P_B, chained after P_A).
  - When P_A settles, `closeBoardHere`'s continuation runs first, because it was registered first, and calls `room.destroy()`. P_B's `persist` then returns at `if (!this.dirty || this.destroyed)` (rooms.ts:1428), so the change is never written.
  - The caller returns success to the API/MCP client. On trash, `closeKeepingContent` then stores the snapshot taken before (boards/service.ts:986-989).
- **Impact: Low.** An agent or API client is told a write or proposal succeeded on a board that was trashed in the same instant; after restore it is missing.
- **Security-sensitive: no.**
- **Suggested fix:** Have `withLiveRoom` callers check that their flush actually persisted: make `flush()` reject or return false when the room was destroyed with unsaved changes, so `BoardClosedError` reaches the caller. Regression test: gate the save as rooms.test.ts does, trash meanwhile, and expect the request to fail.

#### RT-9. Following someone stops for good after a blip in one's own connection

- **Status: CONFIRMED by trace.**
- **Evidence:** On every close, y-websocket removes all remote awareness states (y-websocket.js:143-151). The next `followStep` finds no followed client and calls `editor.follow(null)` (camera/follow.ts:39-43), unless `locked` (a facilitator's follow-me). After the reconnect, following is not resumed.
- **Impact: Low (UX).** A presenter-follower loses the view on any network hiccup.
- **Security-sensitive: no.**
- **Suggested fix:** While `status !== 'connected'`, hold the follow target (as `locked` does) and only drop it if the person is still absent some seconds after resync. Regression test: a fake awareness removal plus a status change, then expect `following` to be kept.

#### RT-10 (SUSPECTED). A proposal racing a revocation or another instance's room load loses its KAI-224 hint, so a revoked app's suggestions stay pending

- **Status: SUSPECTED.** The read-then-write across `await` is certain, but the window is one DB round trip and needs a proposing request authorized before the revocation, or a second instance loading the board.
- **Evidence:**
  - `proposeSuggestions` inserts the hint (`noteSuggestionAuthor`, rooms.ts:1867) and *then* writes the records (rooms.ts:1874).
  - `withdrawSuggestionsOn` (rooms.ts:1945-1958) and `Room.load` on another instance (rooms.ts:522-523) both run `keepSuggestionAuthors(board, pendingNow)`, which DELETEs every hint not in their in-memory pending set (repo.ts:605-612).
  - If either runs between the hint insert and the records becoming visible to it, the hint row for the new proposal is deleted. A later (or the concurrent) revocation finds no board, and the revoked app's suggestions stay pending and can be accepted.
- **Impact: Low.** The suggestions are still human-reviewed.
- **Security-sensitive: yes** (revocation not fully enforced).
- **Suggested fix:** Never delete hints from an in-memory view that can be stale. Delete only hints whose author has no pending record in the *saved* layer, inside the same transaction as the layer save, or re-check the hint after the room's own save. Regression test: two rooms (or a gated `noteSuggestionAuthor`) with a withdrawal in between.

---

### Checked and fine

- **Doc load while sockets arrive / unload during the final save:** the single `ready` promise plus `pendingJoins`, and `idle()` re-checked after each await in `unloadRoom` (rooms.ts:1568-1585). Covered by rooms.test.ts.
- **Persist failure mid-way:** main-doc updates are re-queued at the front only if not appended. Layer saves are popped one by one and the rest re-queued. `touchBoard` failing after append doesn't double-append. Duplicate log rows from retries are harmless (Yjs idempotent) (rooms.ts:1427-1469).
- **Compaction vs saves vs saveInitialState:** `compact` swaps the base only if `version === fromVersion` under `FOR UPDATE` and deletes exactly the folded ids. `saveInitialState` bumps `version`, so a racing compaction skips (repo.ts `compact` / `saveInitialState`). Rows appended during a compaction stay.
- **Automatic snapshots from several instances:** `insertSnapshotIfDue` checks the newest snapshot under the base-row lock (repo.ts `insertSnapshotIfDue`).
- **Board deleted while open:** the next append hits an FK violation → `BoardGoneError` → `dropRoom` closes with 4403 (repo.ts:28-36, rooms.ts:1456).
- **Instance died before saving relayed changes:** `saveMissing` on unload appends what the DB lacks (rooms.ts:1041-1058).
- **Layer updates and role changes:** readability is re-checked per socket at send time (rooms.ts:610-614). Gaining edit sends step 1 for the doc and layers, so writes dropped while locked land (rooms.ts:831-843).
- **API accept/reject twice:** `planDecision` only sees pending records → `SuggestionNotFoundError` (suggestions.ts:155-158). Plan and apply run in one synchronous block after `withLiveRoom`'s awaits, so nothing interleaves (rooms.ts:1905-1916).
- **API accept after the target changed:** `reviewSuggestions` → `SuggestionStaleError` unless `force`. Forced: updates of gone items are skipped and dangling refs are dropped (suggestions.ts:166-194).
- **Two sockets accepting the same create at once:** both write the same element id (LWW, one sticky). The second decision is "decided → decided" and is reverted. Covered by web `__tests__/suggestions.test.ts` ("two editors accepting…").
- **A socket reopening a withdrawn suggestion:** the `by: WITHDRAWN_BY` decision can't be cleared by any user (suggestions.ts:228).
- **An agent proposing on a deleted board:** the flush hits `BoardGoneError` → dropRoom. The records are never stored (but see RT-8 for the success reported to the caller).
- **Client terminal states:** 'denied'/'removed' ignore later `status` events and stop reconnecting (BoardStore.ts:270, 285-286). ObjectDocStore does the same for docs.
- **Device copy writes vs forget/wipe:** vault operations are serialized and saves are fenced by `generation`, so a save queued before a forget can't resurrect the copy after it (vault.ts:64-66, copies.ts:86-101).
- **Edits made offline by someone demoted meanwhile:** refused by the server rules on step 2 (documented in ARCHITECTURE "Offline copies"; tested in realtime/offline.test.ts). The client keeps the diverged local state, which is by design.
- **Facilitator-gone timer across instances:** presence of other instances counts. The end is an idempotent key delete (rooms.ts:868-883).
- **LiveBoardStatus:** derived purely from connection + synced. A disconnect drops `synced` (y-websocket), so it reads 'connecting'. 'denied'/'removed' are terminal through the store.

## Integrations, moderation queues and background jobs (INT)

### Machines

#### INT-M1. Exclusive job run (per job, per instance): `platform/jobs.ts:25-42`, `platform/db.ts:336-351`
- **States:** *idle*; *running here* (the key is in `heldLocks` and a session advisory lock is held on a dedicated pool client, `db.ts:131-152`); *running elsewhere* (another session holds `pg_try_advisory_lock(key)`); *stopped* (after shutdown).
- **Invariants:**
  - At most one run of a lock key at a time across all instances.
  - Lock keys are unique per job/consumer (`jobs.ts:12`, `outbox.ts:44`).
  - Shutdown resolves only after the in-flight run has finished ("never close the database under a running job", `jobs.ts:40`).
  - Runs are idempotent: a run cut short is finished by the next one (`jobs.ts:2-3`).

| from → to | trigger | guard | file:line |
|---|---|---|---|
| idle → running here | `setInterval`/first `setTimeout` tick | `heldLocks.has(key)` (in process), `pg_try_advisory_lock` (cluster) | `jobs.ts:28-34`, `db.ts:337-341` |
| running elsewhere/here → (skip) | tick while the key is held | `withAdvisoryLock` returns null | `db.ts:337,341` |
| running → idle | `run` resolves or throws (logged, `jobs.ts:30`) | `finally` unlocks and releases the client | `db.ts:344-349` |
| any → stopped | `ctx.onShutdown` | `await running`, but `running` is the **latest tick's** promise (INT-5) | `jobs.ts:36-41` |
| (job throws) | — | logged; the next tick runs again; no backoff | `jobs.ts:30` |

#### INT-M2. Outbox consumer cursor (platform, used by `webhooks` and `trackers`): `platform/outbox.ts:164-205`
- **States:** cursor `(txid, event_id)` in `_outbox_cursors`; per instance `running`/`again`; per batch `failures {firstId, count}`.
- **Invariants:**
  - The cursor moves only after `handle` returned (at-least-once).
  - One run per consumer across instances (advisory lock).
  - Events are read only below `pg_snapshot_xmin` (no skipped late commits).

| from → to | trigger | guard | file:line |
|---|---|---|---|
| cursor c → c' | batch handled | lock; cursor upsert after `deliver` | `outbox.ts:188-195` |
| batch failing → retried | `handle` throws, attempt < 3 | rethrow, cursor kept | `outbox.ts:143-146` |
| batch failing → per-event → skipped | third failure | events that still fail are skipped and counted | `outbox.ts:149-157` |

#### INT-M3. Webhook endpoint: `webhook_endpoints` (`modules/webhooks/migrations/202611101020_webhooks.sql`)
- **States:**
  - *on*: `enabled = true`, `disabled_reason` NULL, `consecutive_failures` ≥ 0.
  - *off by Freero*: `enabled = false`, `disabled_reason` set.
  - *off by an admin*: `enabled = false`, `disabled_reason` NULL.
  - *deleted* (no row; its deliveries cascade).
- **Invariants:**
  - An endpoint that is off or deleted receives nothing.
  - `consecutive_failures` resets on a success or when turned on.
  - Workspace cap of `WEBHOOK_MAX_ENDPOINTS`.

| from → to | trigger | guard | file:line |
|---|---|---|---|
| none → on | `createEndpoint` | `pg_advisory_xact_lock(workspace)` + count in one tx | `webhooks/service.ts:223-228`, `repo.ts:79-81` |
| on → on (failures+1) | failed attempt | `SELECT … FOR UPDATE` of the endpoint in `markFailed`'s tx | `repo.ts:264-283` |
| on → off by Freero | failed attempt with `failures >= disableAfterFailures` and `before.enabled` | same tx | `repo.ts:272-281`; audit + mail `service.ts:497-500` |
| on/off ↔ on/off by admin | PATCH `enabled` | turning on clears the reason and zeroes failures | `repo.ts:119-121` |
| any → deleted | DELETE | `WHERE id AND workspace_id` | `repo.ts:155-157` |

#### INT-M4. Webhook delivery: `webhook_deliveries.status` (`pending | delivered | failed`)
- **Fields:** `attempts`, `next_attempt_at` (NULL unless pending), `delivered_at`. `UNIQUE (endpoint_id, event_id)`; test pings have a NULL `event_id`.
- **Invariants:**
  - One delivery per (endpoint, event) however often the fan-out replays.
  - `delivered` is terminal.
  - Only one sender per row (the job's lock).
  - A delivery is sent only while its endpoint exists and is on.

| from → to | trigger | guard | file:line |
|---|---|---|---|
| none → pending | outbox fan-out / test ping | `ON CONFLICT (endpoint_id, event_id) DO NOTHING`; only enabled endpoints | `repo.ts:208-219`, `service.ts:372-412` |
| pending → delivered | 2xx | none on status (`WHERE id`); the job lock is the only guard | `repo.ts:240-249`, `service.ts:482-484` |
| pending → pending (retry `now + base·4^(n-1)`, ≤ 6h) | failure, `attempts+1 < maxAttempts` | `WHERE id` | `repo.ts:266-268`, `service.ts:486-487` |
| pending → failed | failure at `maxAttempts` (7) | `WHERE id` | same |
| failed/pending → pending (now) | admin "redeliver" | `status <> 'delivered'` | `repo.ts:296-298` |
| delivered/failed → (pruned) | retention, 30 days | `status <> 'pending'`, so a pending row is never pruned | `repo.ts:301-303` |
| pending (endpoint off) → stays pending | — | `dueDeliveries` joins `e.enabled` | `repo.ts:222-237` |

#### INT-M5. Tracker connection: `tracker_connections` (`modules/trackers/migrations/202611100900_trackers.sql`)
- **States:** `status ∈ {active, error, needs_auth}` × `credentials_sealed` (NULL = revoked) × `cooldown_until` × `polled_at`. The row is deleted with its links.
- **Invariants:**
  - `needs_auth` iff `credentials_sealed` is NULL or OAuth was refused.
  - A connection without credentials is never called (`service.ts:351,647`, `connections.ts:79`).
  - Team XOR personal (a CHECK constraint).

| from → to | trigger | guard | file:line |
|---|---|---|---|
| any → active | any successful tracker call (`noteOutcome(c, null)`) | only writes when it differs, **not** conditioned on credentials | `connections.ts:211-213`, `repo.ts:210-216` |
| any → needs_auth (oauth) / error (token) | a call refused with `auth` | — | `connections.ts:213` |
| any → needs_auth, creds NULL | the owner signed out everywhere | `credentials_sealed IS NOT NULL` | `repo.ts:227-236`, `init.ts:38-40` |
| any → active, new creds | PATCH token, then a test; resync | — | `connections.ts:584-617`, `routes.ts:141` |
| any → deleted | DELETE; badges marked disconnected; webhooks dropped | tx | `connections.ts:657-678`, `routes.ts:198-205` |

#### INT-M6. Tracker link: `tracker_links` (row) + `state ∈ {ok, error, paused}` + `attempts` + `retry_at` + `base`; items in `tracker_link_sources`
- **Invariants:**
  - `UNIQUE (board, connection, external_id)`; an item is in at most one link (`UNIQUE (board_id, element_id)`).
  - A link exists iff the board shows its badge (Yjs `trackers[linkId]`) and its items carry `trackerLink = linkId`.
  - `retry_at` non-null ⇒ a sync will be queued.
  - Syncs of one link never run concurrently (the consumer lock).

| from → to | trigger | guard | file:line |
|---|---|---|---|
| none → ok (base {}) → ok (base) | import: `insertLink`, `writeBoard`, `markSynced`, `enqueueSync` | unique index (concurrent imports skip); **not atomic with the cards** (INT-9) | `service.ts:1073-1227` |
| none → ok | send: `createIssue` (external), `setBacklinks`, `insertLink`, `writeBoard` | `linkedItems` read before the external create (INT-3) | `service.ts:806-890` |
| none → ok | an accepted proposal (consumer) | unique index; `dropProposal` on conflict | `service.ts:1401-1474` |
| ok/error/paused → ok | `syncLink` success, `markSynced` | none (`WHERE id`) | `service.ts:541`, `repo.ts:435-442` |
| any → error (+retry) | sync failure (`failLink`); `auth` ⇒ `retry_at` NULL | `WHERE id` | `service.ts:257-302`, `repo.ts:445-453` |
| any → paused | the linker lost edit access / the board moved workspace | — | `service.ts:341-350, 1572-1589` |
| error (retry due) → error (retry_at NULL) → queued | `pollOnce` → `claimRetries` … `enqueueSync` | claim and enqueue are separate commits with tracker HTTP between them (INT-6) | `service.ts:643,670`, `repo.ts:465-475` |
| any → deleted | every item gone (consumer); unlink (request); connection deleted | `unlink` is not serialised with the consumer (INT-2) | `service.ts:368-381, 1521-1554`, `repo.ts:243-257` |
| (issue deleted remotely) error ↺ | `getIssue` null → `not_found` → retry with backoff up to 6h, forever (INT-8) | — | `service.ts:362-363, 263` |

Inbound webhooks and polls only enqueue syncs (`service.ts:708-709, 662-670`). A redelivered webhook enqueues an idempotent re-sync.

#### INT-M7. Proposed import: `tracker_proposals.decision` (NULL | accepted | rejected) + `linked_at`
| from → to | trigger | guard | file:line |
|---|---|---|---|
| none → pending | MCP `import_from_tracker` with suggest only | PK `(board, item)` | `repo.ts:492-504` |
| pending ↔ accepted/rejected/pending | realtime decision (accept, reject, undo) | matched by board + group + item; undo clears `linked_at` | `repo.ts:506-518`, `service.ts:1376-1389` |
| accepted → linked | consumer `linkAcceptedProposals` | single consumer; unique index | `service.ts:1401-1474`, `repo.ts:551` |
| any → dropped | issue or item linked otherwise, access gone | — | `repo.ts:556` |
| decided → pruned | poll job, after the undo window + 1h | `decided_at < before` | `init.ts:27`, `repo.ts:561` |

#### INT-M8. Webhook registration in the tracker: `tracker_webhooks.state ∈ {pending, active, failed}` (`202611270900_tracker_asana_monday.sql`)
| from → to | trigger | guard | file:line |
|---|---|---|---|
| none/failed/stale pending → pending (new id) | `ensureWebhooks` | `claimHook`: `ON CONFLICT … WHERE failed OR pending older than 2 min` (the id swap acts as a compare-and-set) | `repo.ts:662-673`, `hooks.ts:64-66` |
| pending → pending + secret | handshake / ClickUp answer | `state='pending' AND secret IS NULL AND fresh` | `repo.ts:675-678` |
| pending → active | register returned | **`WHERE id` only** (INT-10) | `repo.ts:680-682`, `hooks.ts:77` |
| pending/active → failed | register error; switched to polling; secret rotated; connection removed | `WHERE id` | `repo.ts:684-686`, `hooks.ts:87-95` |
| failed → pending | poll job retry after 15 min | connection `status='active'`, inbound webhook | `repo.ts:689-699`, `hooks.ts:98-103` |

#### INT-M9. Tracker OAuth consent: `tracker_oauth_flows`
Single use: `DELETE … WHERE state_hash AND expires_at > now() RETURNING` (`repo.ts:589-596`).

#### INT-M10. Community listing: `marketplace_listings.status` (`modules/marketplace/migrations/202611140900_marketplace.sql:16`) + `featured`
- **Invariants:**
  - Only `approved` is visible to anyone other than the submitter and operators (`marketplace/service.ts:124,133-138`).
  - `featured` ⇒ `approved`.
  - pending+approved ≤ `MAX_LISTINGS_PER_USER`, counted under `pg_advisory_xact_lock` (`repo.ts:69-100`).

| from → to | trigger | guard | file:line |
|---|---|---|---|
| ∅ → pending | submit (rate-limited, verified email) | quota under xact lock | `marketplace/service.ts:141-162` |
| pending, rejected → approved | `act listing.approve` | `UPDATE … WHERE status = ANY(from)`; a retry gets 409 | `service.ts:230`, `repo.ts:127-134` |
| pending → rejected / approved → removed (unfeatured) / removed → approved | `act` reject / remove / restore | same compare-and-set | `service.ts:232-236` |
| approved: featured ↔ not | `act` feature / unfeature | `status='approved' AND featured<>$2` | `repo.ts:137-143` |
| any → ∅ | the submitter withdraws | `submitter_id` | `service.ts:164`, `repo.ts:146` |

#### INT-M11. Community template: `gallery_templates.status` (`modules/gallery/migrations/202612031420_gallery.sql:13`)
- Same table as M10, without featuring:
  - approve, reject, remove, restore: `gallery/service.ts:270-276`
  - compare-and-set: `repo.ts:132-140`
  - quota: `repo.ts:68-80`
- `published_at` is set on the first approval and kept afterwards (`repo.ts:135`).

#### INT-M12. Moderation queue item: `moderation_items.status ∈ {open, actioned, dismissed}` (`modules/moderation/migrations/202610311003_moderation.sql:10`)
- **Invariants:**
  - One open item per dedupe key (partial unique index `WHERE status='open'`, `:28`): one per reporter and target, one open appeal per action.
  - Resolved rows have `resolved_at` and `resolved_by` set.

| from → to | trigger | guard | file:line |
|---|---|---|---|
| ∅ → open (report) | POST /api/reports | `ON CONFLICT (dedupe_key) WHERE status='open' DO NOTHING` | `moderation/service.ts:125-230`, `repo.ts:69-94` |
| ∅ → open (appeal) | appeal with a signed token | not `reversed(a)`; dedupe `appeal:<actionId>` (a repeat gets 409) | `service.ts:752-781` |
| open → actioned / dismissed | `act` with an itemId / `resolve` | `UPDATE … WHERE status='open'` | `service.ts:545-548, 707-719`, `repo.ts:126-133` |

#### INT-M13. Moderation action and its reversal (implicit; `moderation_actions` is append-only)
- An action with a later REVERSAL action is reversed; one without is standing (`service.ts:93-100,730-733`).
- Suspension children are linked by `parent_id` (`:569-622`).
- A double execution is refused by the owning module's compare-and-set (`:412-463`, 409 at `:524`).
- `execute`, `record_`, `resolveItem` and the notices are separate statements (INT-107).

#### INT-M14. Kept copy of a removed upload (implicit: `uploads.removed_at` + `quarantine_key`)
- States: live (`removed_at` NULL); removed and restorable (key set); purged (`removed_at` set, key NULL).
- Transitions: `upload.remove`, `upload.restore` (needs the key), `upload.purge`.
- The `moderation:kept-copies` job purges copies past `MODERATION_KEEP_REMOVED_DAYS` unless an open upload item exists (`moderation/init.ts:11-19`, `service.ts:631-654`).

#### INT-M15. Problem report: `problem_reports.status ∈ {new, triaged, fixed, wontfix, duplicate}` + `closed_at` + `screenshot_key` (`modules/problems/migrations/202611201000_problem_reports.sql:15`)
- **Invariants:**
  - `closed_at` is non-null iff the status is fixed, wontfix or duplicate (`problems/repo.ts:111`).
  - At most one screenshot, attached by the reporter within the window.
  - "fixed" is notified once.

| from → to | trigger | guard | file:line |
|---|---|---|---|
| ∅ → new | POST /api/problems | rate limit | `problems/service.ts:72-83` |
| screenshot ∅ → key | PUT screenshot | `screenshot_key IS NULL AND created_at > window`; the losing file is deleted | `service.ts:90-102`, `repo.ts:87-94` |
| any → any status | operator app / `problems:triage` API (operator re-checked on every request, `api/routes.ts:75`) | `SELECT … FOR UPDATE` in the tx | `repo.ts:100-127`, `service.ts:155-188` |
| → fixed (first time) | same | `before.status !== 'fixed'` + dedupe `problem.fixed:<id>` | `service.ts:178-186` |
| closed → ∅ | `problems:retention` job | `DELETE … WHERE closed_at < due` (a reopened report survives) | `service.ts:193-205`, `repo.ts:145` |
| any → ∅ | account purge | none (INT-105) | `service.ts:208-212` |

#### INT-M16. Notification delivery: `notifications.read_at`, `emailed_at`, `slacked_at` (`modules/notifications/migrations/202610291000_notifications.sql`, `202611291050_notifications_slack.sql`)
- **Invariants:** each notification goes by one channel; `UNIQUE (user_id, dedupe_key)`.

| from → to | trigger | guard | file:line |
|---|---|---|---|
| ∅ → pending | `notify()` | access check; `ON CONFLICT dedupe DO NOTHING` | `notifications/service.ts:48-75`, `repo.ts:49-62` |
| pending → slack-claimed | afterCommit `toSlack` | `slacked_at IS NULL AND emailed_at IS NULL` | `service.ts:95-129`, `repo.ts:119-121` |
| slack-claimed → pending | Slack refused | both columns cleared | `repo.ts:127-129` |
| un-emailed → digest-claimed | digest job | atomic `UPDATE … RETURNING`; Slack-claimed rows skipped | `service.ts:412-442`, `repo.ts:100-106` |
| digest-claimed → pending | `sendMail` threw | `unclaim` | `service.ts:436` |

#### INT-M17. Due reminder and board-change digest window
- **Due reminder:** `card_due_watch.reminded_for` is reset when the due date or assignee changes (`notifications/repo.ts:241-242`) and marked after each candidate (`cards.ts:135`).
- **Board-change digest window:** `board_change_digests.last_sent_at` is moved by a compare-and-set (`repo.ts:323-331`) and moved back if the send fails (`boardChanges.ts:97-99`).
- **The `notifications:digest` job** (lock `7_202_610_291`, `init.ts:36-50`) runs four steps in sequence with no isolation between them (INT-101).

#### INT-M18. Fire-and-forget mail
`sendMailLater` keeps in-flight sends only in an in-memory set (`platform/mail.ts:61-75`). There is no durable queue (INT-103).

#### INT-M19. Slack workspace bot token: `slack_teams` row present or absent (writer `modules/slack/repo.ts:11-27`)
- **Intended invariant:** forgotten and revoked when nobody in that Slack workspace is linked (`slack/links.ts:87-91`). While someone is linked, a valid token is stored.

| from → to | trigger | guard | file:line |
|---|---|---|---|
| absent/stored → stored | Connect Slack callback, after `oauth.v2.access` and **before** the two further Slack calls and `setLink` | none | `slack/oauth.ts:193-205`, `repo.ts:11` |
| stored → stored (re-sealed) | `botTokenFor` reads a stale seal | an **upsert** (it can re-create a deleted row) | `links.ts:63` |
| stored → absent + `auth.revoke` | disconnect when `linksInTeam == 0` | count, then delete, no lock (INT-201) | `links.ts:92-110` |
| stored → absent | `app_uninstalled` / `tokens_revoked` | signed request | `routes.ts:325`, `repo.ts:20` |

#### INT-M20. Person ↔ Slack account link: `slack_user_links` (PK `user_id`, UNIQUE `(team_id, slack_user_id)`)
| from → to | trigger | guard | file:line |
|---|---|---|---|
| unlinked/linked → linked | consent callback | `takeFlow` single use + browser cookie hash; tx (delete the other owner, then upsert) | `slack/oauth.ts:171-205`, `repo.ts:76-93` |
| linked(A) → unlinked | another account consents as the same Slack user | none (silent takeover) | `repo.ts:78` |
| linked → unlinked | disconnect / uninstall / account deleted (FK cascade) | — | `links.ts:93`, `repo.ts:22` |

Slack consent flows (`slack_oauth_flows`) are single use: `DELETE … WHERE state_hash AND expires_at > now() RETURNING` (`repo.ts:113`). Event de-duplication is an in-process `seen` map, per instance (`service.ts:213-221`).

#### INT-M21. Figma connection: `figma_accounts` (PK `user_id`)
| from → to | trigger | guard | file:line |
|---|---|---|---|
| any → connected | OAuth callback | single-use flow + cookie | `figma/oauth.ts:238-273`, `repo.ts:40` |
| expiring → fresh | `withFigmaToken` refresh | `UPDATE … WHERE user_id` (not conditioned on the connection it read) | `tokens.ts:145-154`, `repo.ts:51` |
| connected → dropped | refresh refused (400/401/403) or unreadable | `DELETE WHERE user_id` (unconditioned, INT-204) | `tokens.ts:147-161` |
| connected → disconnected | DELETE /integrations/figma/me | — | `service.ts:44` |

#### INT-M22. Zoom meeting board, link-card preview, import dialog
- **Zoom** (`zoom_meeting_boards`): none → set(board, +24h) → expired. The last writer wins (`zoom/repo.ts:5`). Board access and `boardEmbedding` are re-checked on read (`service.ts:37-49`).
- **`EmbedElement.status`** (Yjs, `packages/shared/src/elements.ts:753`): `loading` → `ready` | `failed` (`apps/web/src/features/embed/lib/preview.ts:51-77`). A card deleted or re-pointed meanwhile is left alone (`:70`). An abandoned `loading` card renders as a plain link (`:23-27`).
- **Import dialog** (`apps/web/src/features/import/panel.tsx`, `lib/insert.ts`; server `modules/importers/service.ts`): idle → busy → placed (one `editor.transact`) | error | closed.
  - Cancel closes the panel but **does not leave busy**. The answer that arrives afterwards is placed anyway (INT-203).
  - A picture that fails becomes `null` and is reported (`importers/service.ts:64-68`). Copied uploads count toward quota until the 24h sweep.
- **Atlassian (forge) and Meet:** no persisted state (a generated package, served pages).

---

#### Changes made by the fixes

These supersede the machine descriptions above where they differ.

- **Webhooks (M3, M4), #190:** every send is preceded by `liveTarget` (`webhooks/repo.ts`), which joins the delivery to its endpoint as it is now (`status = pending AND enabled`) and reads the URL and secret fresh, so nothing more is sent from a run to an endpoint deleted or turned off meanwhile. Fan-out (`none → pending`) queues for endpoints that are enabled or that Freero turned off after failures (`disabled_reason IS NOT NULL`); an endpoint an admin turned off collects nothing. Retention prunes every delivery older than 30 days, pending included.
- **Exclusive job and outbox consumer (M1, M2), #189:** advisory lock keys are reserved at registration (`reserveLockKey`, `platform/db.ts`); a duplicate fails at boot naming both jobs. The scheduler skips a tick while its own run is in progress, and graceful shutdown waits for in-flight runs and consumers (one shared 10 s limit) before the database closes. The outbox prune is an ordinary exclusive job (`outbox:prune`).
- **Tracker link retries (M6), #189:** `error (retry due) → queued` is one transaction (`claimRetries` + `appendOutbox`) at the start of `pollOnce`, before any tracker call.
- **Notification delivery (M16–M18), #189:** a digest the mail server refuses increments `email_attempts` and sets `email_retry_at` (5 min doubling to 6 h); after 8 attempts it is given up on and its notifications stay in the inbox. A failure before sending hands the claim back without counting an attempt. Due people are ordered by their oldest pending notification. The four digest-job steps and each board's due reminders fail independently. Mail queued with `sendMailLater` is drained (up to 5 s) during graceful shutdown; a crash still loses it.
- **Moderation queue, actions and kept copies (M12–M14), #192:** whether a report is the first open item about its target is decided in the insert's transaction under a per-target advisory lock, so exactly one alert goes out per first report. An appeal is refused (409 `appeal_final`) once its target is gone for good (kept copy purged, board gone, listing or template withdrawn), and the appeal page says so. Listing and template decisions and their action record commit together; board, upload and user actions still record after their effect (INT-107, open).
- **Community listings and templates (M10, M11), #192:** visible to others = `approved` and the submitter not suspended, derived on every public read; operator decisions (approved, featured) are untouched, so lifting a suspension brings them back as they were.
- **Problem reports (M15), #192:** deleting reports lists their screenshot keys in `problem_screenshot_deletions` in the same statement; a key leaves the list only after its file delete succeeds, and `problems:retention` retries leftovers first. Invariant: a deleted report's screenshot key stays listed until its file is deleted.
- **Tracker connection (M5), #191:** every status write from a call (sync outcome, connection test) applies only while the stored credentials are the ones the call used; with credentials cleared, `needs_auth` is left only by connecting again. An OAuth refresh stores its tokens only over the credentials it started from and refuses to refresh revoked ones.
- **Tracker link (M6), #191:** new state `pending` (migration `202612051100_tracker_link_pending.sql`). `none → pending` when a send claims its items (placeholder external id) or an import inserts its links; `pending → ok` by `activateLink` (only while still pending) or the import's `markSynced`; `pending → deleted` when the issue wasn't created, the import's board write failed, or a send claim is older than 1 h; a stale import claim becomes `error` with an immediate retry. Nothing syncs, polls, retries, fails, pauses or links dependencies to a pending link, so a second send of the same items gets 409 `tracker_already_linked`. A sync re-checks its link just before and after its board write and cleans up its badge, marks and back-links if it was unlinked meanwhile. An issue found gone three syncs in a row becomes `error` with no retry (terminal until Sync now), and its badge says so.
- **Tracker webhook registration (M8), #191:** `pending → active` requires `state = pending` for that registration's id; otherwise the webhook just made in the tracker is unregistered.
- **Slack bot token and links (M19, M20), #193:** a consent claims its Slack team (`slack_team_claims`, 10-minute TTL) before further Slack calls; the token is written only together with a link, in one transaction under a per-team advisory lock that consumes the claim. With no links and no live claims the team goes `stored → revoking` (`revoking_at`) under the lock; `auth.revoke` runs outside it, then `revoking → absent` only if the same mark is still set. Invariant: the token is kept exactly while the team has a link or a live claim. Every path that removes a link (Disconnect, relinking to another team, account deletion, a failed consent) ends in `releaseSlackTeam`.
- **Figma connection (M21), #193:** a token refresh and a drop are compare-and-set on the `linked_at` of the connection they read, so a connection made since is never overwritten or deleted.
- **Import dialog (M22), #193:** idle → busy → placed | error | cancelled. Cancel (or Esc, or closing) aborts the request; `cancelled` is final and nothing more is stored or placed. The server stops a Miro import between calls and before each picture when the request is aborted (this depends on the proxy in front passing the disconnect on).

### Findings

Ordered within each area by impact.

#### INT-1 — An endpoint that was deleted or turned off while the delivery job was running keeps receiving deliveries for the rest of that run
- **Status:** CONFIRMED (failing test).
- **Evidence:**
  - `deliverDue` loads up to 25 due deliveries, each joined to a **snapshot** of its endpoint taken at the start (`modules/webhooks/repo.ts:222-237`). Each worker then sends one endpoint's queue in a loop (`service.ts:511-521`).
  - `attempt` uses the snapshot's URL and secret (`service.ts:466-480`) and never re-reads the endpoint.
  - After a delete, `markDelivered`/`markFailed` update nothing (the rows cascaded). `markFailed` returns `{failures: 0, disabled: false}` (`repo.ts:271`), so `attempt` returns true and the loop goes on.
  - Turning the webhook off, changing its URL or rotating its secret is likewise ignored until the next run.
  - With a receiver that times out (10s each), one run can keep posting for minutes.
- **Test:** `modules/webhooks/webhooks.sm-audit.test.ts`, "INT-1: an endpoint an admin deleted mid-run receives no further deliveries from that run". Three pings are queued, and the receiver deletes the endpoint while answering the first. Output: `AssertionError: expected [ …(3) ] to have a length of 1 but got 3`.
- **Impact:** Medium. Board events (titles, item text, actor names) go to a URL an admin just removed. That is often the reason for removing it: a leaked or wrong URL, a receiver that is misbehaving. It is bounded by the 25-row batch, and a slow receiver is exactly when the run lasts long.
- **Security-sensitive:** yes (data leaves to a destination the workspace admin revoked).
- **Suggested fix:** Before each attempt, re-read the endpoint (`enabled`, `url_sealed`, `secret_sealed`) and skip the attempt if it is gone or off. Or claim each delivery with `UPDATE … WHERE id AND status='pending' AND endpoint enabled RETURNING` joined to the live endpoint row. Regression test: the one above, plus a variant that turns the endpoint off instead of deleting it.

#### INT-2 — Unlinking an issue (or removing its connection) while that link's sync is in flight leaves a ghost badge and `trackerLink` marks on the board for a link that no longer exists
- **Status:** CONFIRMED (failing test).
- **Evidence:**
  - `unlink` is an HTTP request. It deletes the row (`service.ts:1524`), then clears the badge and the items' `trackerLink` (`:1536-1539`). It is not serialised with the trackers consumer that runs `syncLink`.
  - `syncLinkOnce` read the link at `:335` and keeps going after the delete:
    - It may re-add the backlinks in the tracker (`:437-447`).
    - Its `writeBoard` (`:480-532`) writes the badge again (`prev` is gone, so `!sameBadge`) and re-marks the items (`el.trackerLink !== link.id`, `:509`).
    - `markSynced` then updates nothing (`repo.ts:435`).
  - The same happens with `DELETE /trackers/connections/:id`. `markDisconnected` writes "disconnected" badges (`service.ts:1595-1630`), then the in-flight sync overwrites one with state `ok`.
- **Test:** `modules/trackers/trackers.sm-audit.test.ts`, "INT-2: an issue unlinked while its sync is in flight leaves no badge or link mark on the board". It holds the sync at `github.getIssue` and unlinks meanwhile. Output: `expected { badge: true, mark: "jePIFv3tD2jLF1JR" } to deeply equal { badge: false, mark: null }`.
- **Impact:** Medium.
  - The board shows a linked, "synced" issue that never syncs again.
  - The badge can't be removed through the app: unlink answers 404 "No such linked issue" (`service.ts:1516`), and nothing reconciles orphan badges.
  - The issue may keep links back to the cards.
  - Trigger: "Sync now", or an edit, followed by Unlink within a few seconds; or removing a connection that has busy links.
- **Security-sensitive:** no.
- **Suggested fix:** Run unlink (and connection removal) through the same serialisation as syncs: enqueue an `unlink:<id>` outbox event, or take the consumer's lock with `whileConsumerPaused`. Also make `syncLinkOnce`'s board write conditional on the link still existing, re-checked inside the `changeBoard` plan; add a `link_version` compare if needed. Regression test: the one above, plus the connection-removed variant.

#### INT-3 — Sending the same items twice at once (a double submit, or an agent retrying `sync_to_tracker`) creates two issues in the tracker; the second is never linked
- **Status:** CONFIRMED (failing test).
- **Evidence:**
  - `sendToTracker` checks `repo.linkedItems` (`service.ts:806-810`). It then calls `provider.createIssue` (`:845`) and `setBacklinks`, which points the new issue at the board items (`:852-863`), and only then runs `insertLink` (`:884`).
  - The second request passes the same check, creates a second issue, and fails `insertLink` with `ItemAlreadyLinkedError`. It returns 409 "Those items were linked meanwhile" (`:965`) and leaves the second issue in the tracker, carrying links back to the board.
- **Test:** `modules/trackers/trackers.sm-audit.test.ts`, "INT-3: sending the same items twice at once creates one issue in the tracker, not an unlinked duplicate". Output: `expected [ { method: 'POST', … }, … ] to have a length of 1 but got 2` (two `POST /repos/acme/send/issues`). One request succeeded; the other got 409.
- **Impact:** Medium. Duplicate issues land in the team's tracker and look linked (they hold links back to the board) but never sync. MCP agents retry timed-out tool calls, and a UI double submit has the same effect.
- **Security-sensitive:** no.
- **Suggested fix:** Reserve the items before the external create. Insert the link rows (or a `tracker_link_sources` reservation) in state `sending` first, keyed on `(board, element)`, then create the issue and fill in `external_id`, and delete the reservation if the create fails. Or serialise sends per board with `pg_advisory_xact_lock`. An idempotency key on the request (the MCP call id) helps retries too. Regression test: the one above.

#### INT-4 — Advisory lock keys are not unique: the tracker poll job shares its key with the search index consumer, and three other pairs collide, so each pair blocks and skips the other
- **Status:** CONFIRMED (traced; the constants are equal).
- **Evidence:**
  - Colliding keys:

    | Key | Holders |
    |---|---|
    | `7_202_611_101` | `trackers:poll` (`modules/trackers/init.ts:17`) and the `search` outbox consumer (`modules/search/service.ts:36`) |
    | `7_202_611_301` | `keys:check` (`modules/keys/init.ts:14`) and the `blueprints` consumer (`modules/blueprints/service.ts:201`) |
    | `7_202_611_031` | `boards` link expiry (`modules/boards/init.ts:15`) and the `references` consumer (`modules/references/service.ts:15`) |
    | `7_202_610_301` | `auth:two-factor-recovery` (`modules/auth/init.ts:13`) and `sso:cleanup` (`modules/sso/init.ts:10`) |

  - All of them go through `withAdvisoryLock` (`platform/db.ts:336-350`), which returns null when the key is held, whether in-process (`heldLocks`) or by another session.
  - A `pollOnce` makes sequential tracker HTTP calls with timeouts for every due connection (`modules/trackers/service.ts:646-669`). For its whole duration the search consumer can't run on **any** instance, so the search index stops updating.
  - The search consumer runs every second and after every commit (`platform/outbox.ts:259-298`). A poll tick that lands while it holds the key is skipped.
  - Likewise, a slow KMS call in `keys:check` stalls workspace-membership blueprint handling. A `keys:check` tick skipped by the consumer delays the KMS-revocation probe, which is documented as "within one cache period" (`modules/keys/init.ts:13`).
- **Impact:** Medium. The documented "unique per job" invariant (`platform/jobs.ts:12`, `platform/outbox.ts:44`) is broken. Search freshness stalls for as long as a tracker poll runs (minutes with slow trackers), and polls and KMS checks are skipped at random. Every instance is affected, nothing logs it, and no error is visible.
- **Security-sensitive:** partly. The `keys:check` revocation latency is a security property.
- **Suggested fix:** Give each a fresh key. Then add a startup assertion: a registry in `platform/jobs.ts` and `platform/outbox.ts` that throws on a duplicate `lockKey`, or derive keys from `hashtext(name)`. Regression test: a test that imports every module's `init` with a fake ctx and asserts the keys registered are distinct (this guards the invariant, not a constant).

#### INT-5 — Shutdown doesn't wait for a job run longer than its interval; the database is closed under it
- **Status:** CONFIRMED (failing test).
- **Evidence:**
  - `scheduleExclusiveJob` overwrites `running` on every tick (`platform/jobs.ts:30`).
  - A tick while the previous run is still going gets `null` from `withAdvisoryLock` at once (`heldLocks`, `db.ts:337`), so `running` becomes an already-resolved promise.
  - On shutdown, `await running` (`jobs.ts:40`) returns straight away, and `main.ts:102` runs `closeDb()` while the real run is still writing.
  - `webhooks:deliver` (1s interval, 10s HTTP timeouts), `trackers:poll` (≤ 15s interval, sequential tracker calls) and `events:derive` (1s) routinely run longer than their interval.
  - The outbox's `schedulePrune` has the same pattern (`platform/outbox.ts:313-321`). `consumeOutbox` itself is correct (`outbox.ts:269-272`).
- **Test:** `platform/jobs.sm-audit.test.ts`, "INT-5: shutting down waits for a job run that is longer than its interval before the database closes". Output: `expected false to be true`.
- **Impact:** Medium. On every deploy that catches a long run, the run's DB writes fail after its external side effect:
  - A webhook POST succeeds, then `markDelivered` fails, so the event is delivered again after restart.
  - A tracker poll's claimed retries are lost (INT-6).
  - Errors are logged on every deploy.
- **Security-sensitive:** no.
- **Suggested fix:** Track the run itself. Only set `running` when a run actually started (or keep a per-job `inFlight` promise set in the `withAdvisoryLock` callback), and skip ticks while a local run is in flight, as `consumeOutbox` does. Regression test: the one above.

#### INT-6 — Due tracker retries are claimed (their `retry_at` cleared) before the poll's tracker calls and only queued at the end, so a poll cut short loses them for good
- **Status:** CONFIRMED (traced).
- **Evidence:**
  - `pollOnce` commits `claimRetries` first (`modules/trackers/service.ts:643`; `repo.ts:465-475`: `UPDATE … SET retry_at = NULL … RETURNING id`, its own statement).
  - It then registers webhooks and polls every due connection over HTTP (`:645-669`).
  - It queues the claimed links only at `:670` (`enqueueSync`).
  - Anything that ends the run in between loses the claim:
    - a throw outside the per-connection `try` (`repo.connectionsWithLinks`, `repo.linksOfConnection` at `:646,651`);
    - a throw from `noteOutcome` inside the catch;
    - a crash or SIGKILL;
    - INT-5's DB close on deploy.
  - Those links stay `state='error'` with `retry_at` NULL, so nothing retries them (`claimRetries` only picks `retry_at IS NOT NULL`). This violates the scheduler's own rule that "the next run finishes the work" (`platform/jobs.ts:2-3`).
- **Impact:** Medium. A link that failed transiently (rate limit, a tracker outage) keeps showing an error and stops syncing until someone edits it or the issue changes. Likelihood: every deploy during a poll (see INT-5) and any DB blip.
- **Security-sensitive:** no.
- **Suggested fix:** Claim and enqueue in one transaction. Do `claimRetries` and `appendOutbox` for those ids together at the start, and poll afterwards. Regression test: make the provider's `changedSince` throw a non-Tracker error after a due retry was claimed (or make a repo call fail), then assert that the link's sync is still queued (`_outbox` has `link:<id>`) or that `retry_at` is still set.

#### INT-7 — A personal tracker connection whose credentials were revoked ("signed out everywhere") goes back to `active`, or to `error`, while it still has no credentials
- **Status:** CONFIRMED (traced).
- **Evidence:**
  - `revokePersonalCredentials` sets `credentials_sealed = NULL, status='needs_auth'` (`modules/trackers/repo.ts:227-236`).
  - Two later writes change the status without looking at the credentials:
    - A sync or poll already in flight with the old decrypted `conn` finishes with `noteOutcome(conn, null)`, which sets `status='active'` (`connections.ts:211-212`, `service.ts:542, 664`).
    - Every later sync of its links goes through `failLink(… TrackerError('auth'))` (`service.ts:351-353`), whose `noteOutcome` sets `status='error'` for a token connection (`connections.ts:213`). That overwrites `needs_auth` and the "signed out everywhere" note.
  - `requireUsable` and `pollOnce` still refuse the connection because the credentials are NULL, so no call is made. The managed list, though, shows `active` or a generic error.
- **Impact:** Low. Wrong status in Settings: it shows a connection that looks fine, or a vague error instead of "connect again".
- **Security-sensitive:** no (no call is made without credentials).
- **Suggested fix:** Make `noteConnectionStatus` conditional: `WHERE credentials_sealed IS NOT NULL` for `active`, and never downgrade `needs_auth` to `error`. Or derive "needs auth" from `credentials_sealed IS NULL` when reading. Regression test: revoke, run a sync of one of its links, and assert the status is still `needs_auth`.

#### INT-8 — A linked issue deleted in the tracker leaves its link retrying every 6 hours forever
- **Status:** CONFIRMED (traced).
- **Evidence:** `getIssue` returns null, which raises `TrackerError('… no longer exists …', 'not_found', 404)` (`modules/trackers/service.ts:362-363`). `failLink` gives every kind except `auth` a retry (`:263`). The backoff caps at `RETRY_MAX_MS` = 6h (`:231-232`). No state ends this: there is no `gone` state, the link isn't removed, and attempts are never capped.
- **Impact:** Low. Each deleted issue costs one tracker call every 6h forever, and its badge stays "error" until someone unlinks it.
- **Security-sensitive:** no.
- **Suggested fix:** Treat `not_found` after N attempts (or at once, on a 404 with the connection otherwise healthy) as terminal. Either use `state='error'` with `retry_at` NULL and a "deleted in the tracker" note, or remove the link the way the "items deleted" path does. Regression test: delete the issue in the mock tracker, sync twice, and assert `retry_at` is NULL afterwards.

#### INT-9 — A card imported from a tracker can lose its link: the link row is committed before its card exists, and a concurrent sync deletes "a link whose items are all gone"
- **Status:** CONFIRMED (traced; timing-dependent, no test).
- **Evidence:**
  1. `importIssues` commits `insertLink` with `sources = [new card id]` (`modules/trackers/service.ts:1073-1080`), then awaits `writeBoard` to create the cards (`:1085`).
  2. The trackers consumer is handling a `board.content` event of the same board at that moment, from any other save. It lists the board's links (`:627`, now including the new one). `boardSideChanged` reads the stored board, sees the item missing (`:591`) and calls `syncLink`.
  3. `syncLinkOnce` reads the live board before `changeBoard` applied the import (`:359-360`), finds no items, and deletes the link and its badge (`:368-373`, audited as `items_deleted`).
  4. The import's `writeBoard` then creates the card with `trackerLink` and a badge for the deleted link, and `markSynced` updates nothing (`:1224`).
  - Nothing (no lock, no "link not ready" state) separates the import from the consumer.
- **Impact:** Low. Narrow window, and it needs a concurrent save on the same board. The result is the same ghost badge as INT-2, and re-importing adds a duplicate card for that issue.
- **Security-sensitive:** no.
- **Suggested fix:** Create the link in a `pending` state (or with `synced_at` NULL) that the consumer skips, and mark it `ok` after the board write. Or run the import's link insert and board write under the trackers consumer's lock. Regression test: a hook in `writeBoard` (or a held room load) that runs `syncLink` between the insert and the write, then assert the link survives.

#### INT-10 — A tracker webhook registration that finishes after the connection switched to polling (or was removed) is marked `active`, and the tracker's webhook is never unregistered
- **Status:** CONFIRMED (traced).
- **Evidence:**
  - `ensureWebhooks` claims the row (pending, `externalId` NULL) and awaits `provider.webhooks.register` (`modules/trackers/hooks.ts:66-70`).
  - Meanwhile the PATCH `inbound: 'polling'` route runs `dropWebhooks` (`routes.ts:145-146`). It has no `externalId` to unregister (`hooks.ts:91`) and marks the row failed (`:93`).
  - Then `activateHook(h, externalId)` sets `state='active'` (`repo.ts:680-682`, `WHERE id = $1` with no state guard).
  - Result: a polling connection with an active webhook registered in Asana, monday.com, ClickUp or Trello that nobody will unregister.
  - With the connection removed, the row cascades, `activateHook` matches nothing, and the external webhook keeps posting to a 404 address.
- **Impact:** Low. An orphaned webhook stays in the customer's tracker, and the "stop with polling" promise isn't kept. The window is one register round trip.
- **Security-sensitive:** no.
- **Suggested fix:** `activateHook … WHERE id = $1 AND state = 'pending'`. When it matches nothing, unregister the external id it just made, as the catch path already does. Regression test: run `dropWebhooks` while a held `register` is in flight, then assert the hook is not active and `unregister` was called.

#### INT-11 — The "webhook turned off" email promises that events which happen meanwhile are kept and sent again; they are never queued, and old pending ones are kept forever
- **Status:** CONFIRMED (traced).
- **Evidence:**
  - The mail (`modules/webhooks/service.ts:455-456`) says: "Events that happened meanwhile are kept in its delivery log for 30 days… turn the webhook back on… waiting deliveries are sent again."
  - The fan-out only queues for enabled endpoints (`repo.ts:101-103`, `service.ts:375`), so nothing that happens while the endpoint is off is ever delivered.
  - Retention skips `pending` rows (`repo.ts:302`), so the deliveries pending at the moment it turned off are kept indefinitely and sent on re-enable however old they are. They are not limited to 30 days.
- **Impact:** Low. Admins are misled about what they will receive after re-enabling, and a webhook re-enabled months later sends stale events.
- **Security-sensitive:** no.
- **Suggested fix:** Decide the contract. Either keep queuing for endpoints turned off by Freero (not by an admin) and give pending rows the 30-day retention, or change the copy to "events while it is off are not sent; deliveries that were waiting are sent when you turn it back on". Regression test: turn an endpoint off, raise an event, turn it back on, and assert whichever contract was chosen.

#### INT-101 — One board that can't be loaded stops every digest email on the server
- **Status:** CONFIRMED (failing test).
- **Evidence:**
  - The `notifications:digest` job runs sweepPendingMentions → `sendDueReminders` → `sendDigests` → `sendBoardChangeDigests` in sequence inside one `run` (`modules/notifications/init.ts:40-48`).
  - `sendDueReminders` has no per-card try/catch. `getBoardAccess` and `readBoardView` (`cards.ts:118-121`) throw before `markCardReminded` (`cards.ts:135`), so the same watch is picked again every run (`repo.ts:255-264`).
  - The later senders are never reached, and `scheduleExclusiveJob` only logs (`platform/jobs.ts:30`).
  - Rooms whose load rejects behave this way (`realtime/rooms.ts:1552-1557,1752-1757`): an unreadable stored row, or a workspace key whose KMS is unreachable.
- **Test:** `modules/notifications/notifications.sm-audit.test.ts`, "one board that cannot be loaded for a due-date reminder does not stop every other person's digest email". It drives the real job through `initNotifications`; the one stand-in is `readBoardView` failing for one board.
  - Output: `expected [] to have a length of 1 but got +0`, and `job notifications:digest failed … at sendDueReminders (cards.ts:121)` every second.
  - With the board loadable, the same test passes.
- **Impact:** Medium. Every notification digest and board-change email on the instance stops until that card's due date passes or its watch changes. One tenant's KMS outage is enough. Silent apart from logs.
- **Security-sensitive:** no.
- **Suggested fix:** Isolate failures per item (try/catch per watch: log it, then mark it reminded or skip it) and run the three senders independently. Regression test: the one above.

#### INT-102 — Simultaneous first reports of a target never alert the operators
- **Status:** CONFIRMED (failing test).
- **Evidence:**
  - The alert fires when `countOpenForBoard(board) === 1` after the insert (`modules/moderation/service.ts:164-166`, `repo.ts:115-118`).
  - Interleaving: A inserts, B inserts, A counts 2, B counts 2, so neither mails.
  - Listings (`service.ts:195-197`) and gallery templates (`:226-228`) use the same pattern.
- **Test:** `modules/moderation/moderation.sm-audit.test.ts`, "two people reporting a board at the same moment still alert the operators about its first report". Output: `expected 0 to be greater than or equal to 1`. The same two reports made sequentially do alert.
- **Impact:** Low–Medium. The items are in the queue, but operators who rely on mail miss exactly the pile-on case.
- **Security-sensitive:** no.
- **Suggested fix:** Decide "first" atomically: the insert reports whether another open item exists, in one statement, or the insert and count run under an advisory xact lock on the target. Regression test: the one above.

#### INT-103 — Mail queued with `sendMailLater` (moderation notices and appeal links, operator alerts) is lost on graceful shutdown
- **Status:** CONFIRMED (traced).
- **Evidence:**
  - `main.ts:93-103`: `stop()` runs drain → `ctx.shutdown()` → `stopPlatform()` → `closeDb()` → `process.exit(0)` and never awaits `mailIdle()` (`platform/mail.ts:81`). Only `admin.ts` and tests call it.
  - In-flight sends live only in memory (`mail.ts:69-75`).
  - Affected:
    - moderation notices (`moderation/notices.ts`, sent from `act`, `service.ts:556,677`)
    - reporter outcomes
    - marketplace and gallery alerts (`marketplace/service.ts:170-182`, `gallery/service.ts:194-206`)
    - the "webhook turned off" mail (`webhooks/service.ts:449`)
- **Impact:** Low–Medium. On a deploy, a moderated person can lose their only appeal link: the action is recorded, and a repeat of the action gets 409.
- **Security-sensitive:** no.
- **Suggested fix:** Register `mailIdle` as a bounded shutdown hook before `closeDb`, or move notices to a durable outbox. Regression test: shut down the context with a slow transport and assert the mail landed.

#### INT-104 — An appeal against a file removal is accepted after the kept copy was purged, so it can never be granted
- **Status:** CONFIRMED (failing test).
- **Evidence:**
  - `submitAppeal` refuses only `reversed(a)` (`modules/moderation/service.ts:756`). `upload.purge` is not a REVERSAL (`:93-100`) and sends no notice (`:670`).
  - The appeal is queued (`:762-778`) and shown as pending (`:735-749`).
  - `upload.restore` then fails with 409 because there is no quarantine key (`:453`, `:395`).
- **Test:** `modules/moderation/moderation.sm-audit.test.ts`, "an appeal against a file removal is not taken once the file's kept copy was deleted for good (it could never be granted)". Output: `promise resolved "undefined" instead of rejecting`.
- **Impact:** Low. The appeal link stays valid indefinitely, and the operator can only dismiss the appeal. `board.delete` has the same problem.
- **Security-sensitive:** no.
- **Suggested fix:** `submitAppeal`/`appealInfo` check whether the target is still restorable and refuse, or say it is final. Regression test: the one above.

#### INT-105 — Problem screenshots can outlive their report or account when one file delete fails
- **Status:** CONFIRMED (traced, given a storage error).
- **Evidence:**
  - `deleteProblemsOf` deletes all rows first (`modules/problems/repo.ts:130-133`), then loops `await deletePrivateImage(key)` with no catch (`service.ts:208-212`). One throw abandons the remaining keys, and a retried purge finds no rows.
  - `purgeClosedProblems` deletes the row, then the file, and only logs a failure (`service.ts:199-201`).
  - The private area is never swept.
- **Impact:** Low. Personal screenshots are kept past account deletion or the retention period.
- **Security-sensitive:** no (privacy and retention).
- **Suggested fix:** Delete the files before the rows, or keep a key list or tombstone that a retry can finish. Regression test: storage fails once on the second key; the second purge leaves no files.

#### INT-106 — A suspended account's community listings and templates stay public
- **Status:** CONFIRMED (traced). It may be intended, but it is undocumented.
- **Evidence:**
  - `user.suspend` acts only on boards (`modules/moderation/service.ts:542,569-591`).
  - `liveListings` (`marketplace/service.ts:124`, `repo.ts:113-117`) and the gallery's `published`/`publicTemplate` (`gallery/repo.ts:103-117`, `service.ts:103-107`) filter on status only.
- **Impact:** Low. Content from a suspended account stays public, including in the sitemap, until each item is removed by hand.
- **Security-sensitive:** no.
- **Suggested fix:** Make the listings and templates child actions of the suspension, so `user.restore` undoes them, or document that they stay. Regression test: suspend the submitter, then assert both are absent from the public lists.

#### INT-107 — Moderation `act` is not atomic: the target changes but the action record, appeal link or notice can be missing
- **Status:** SUSPECTED.
- **Evidence:** `execute` commits the owning module's change (`modules/moderation/service.ts:523`). `record_`, the children, the item resolution and the notices follow as separate statements (`:526-560`). A failure in between leaves an adverse action with no `moderation_actions` row and no appeal path, and a retry gets 409 (`:524`).
- **Impact:** Low (needs a DB error mid-request).
- **Security-sensitive:** no.
- **Suggested fix:** Run `execute` and `record_` in one transaction (the owning modules' writes join through the db scope), and send notices `afterCommit`. Regression test: fault-inject `insertAction` and assert the target is unchanged.

#### INT-108 — A digest the SMTP server refuses permanently is retried every interval, forever, and can starve others
- **Status:** SUSPECTED.
- **Evidence:**
  - On a reject, `sendDigests` unclaims with no attempt count (`modules/notifications/service.ts:432-437`).
  - `usersWithEmailDue` has `SELECT DISTINCT … LIMIT 200` with no ORDER BY (`repo.ts:91-97`).
- **Impact:** Low. Log and SMTP noise every 60 s. Starving others needs at least 200 permanently rejected recipients.
- **Security-sensitive:** no.
- **Suggested fix:** Count attempts with backoff, and order by the oldest due. Regression test: one recipient is always rejected; another's digest still goes out, and the bad one stops after N attempts.

#### INT-201 — Connecting Slack while the last other person in that Slack workspace disconnects revokes the bot token the new link depends on
- **Status:** CONFIRMED (failing test).
- **Evidence:**
  - `finishSlackConnect` stores the bot token (`modules/slack/oauth.ts:193`), makes two Slack calls (`:195,:201`), and only then writes the link (`:205`).
  - `unlinkSlack` deletes the leaving link, counts the links left (`links.ts:102`), deletes the token (`:105`) and calls `auth.revoke` (`:107`). There is no lock between the two flows.
  - Interleaving:
    1. Sam's callback stores `xoxb-TX`.
    2. Pat, the only link in TX, disconnects: the count is 0, the row is deleted and `xoxb-TX` is revoked at Slack.
    3. Sam's `setLink` commits.
  - End state: Sam is linked with no stored token. Sam's DMs and private unfurls fall back to the operator's `SLACK_BOT_TOKEN` (`links.ts:58-65`), and the real token is revoked.
- **Test:** `modules/slack/slack.sm-audit.test.ts`, "someone connecting Slack while the last other person in that Slack workspace disconnects keeps a bot token there, so their DMs still reach them". Output: `expected [ 'Bearer xoxb-TX' ] to deeply equal []`.
- **Impact:** Medium. Settings say "connected" while every DM and private unfurl fails silently. The window is two Slack round trips.
- **Security-sensitive:** no.
- **Suggested fix:** Tie the token to the installation, so only `app_uninstalled`/`tokens_revoked` revoke it. Or serialise per team with `pg_advisory_xact_lock(hash(team))` around "count → delete" and around "store token + insert link" (one tx, after the Slack calls), re-checking the token under the lock. Regression test: the one above.

#### INT-202 — A Slack bot token outlives every link on paths other than Disconnect, so "forgotten when nobody is linked" holds on one path only
- **Status:** CONFIRMED (traced).
- **Evidence:** The token is deleted only in `unlinkSlack` (`modules/slack/links.ts:102-110`). These paths leave a live token with zero links:
  - reconnecting to another Slack workspace (`setLink` upserts on `user_id`, `repo.ts:79-84`)
  - a takeover of the Slack user (`repo.ts:78`)
  - account deletion (FK cascade on the links only)
  - a consent that stops after `storeBotToken` (`oauth.ts:193-199`)

  Also, the stale re-seal is an upsert that can re-create a row just deleted (`links.ts:63`).
- **Impact:** Low (a sealed, valid token kept at rest against the documented behaviour).
- **Security-sensitive:** no (data retention).
- **Suggested fix:** Choose one invariant, together with INT-201's fix. Make the re-seal an `UPDATE`. Regression test: relink A from TA to TB, delete A, and assert there is no `slack_teams` row for TA (or assert the documented alternative).

#### INT-203 — Cancel in the Import dialog doesn't cancel: the Miro board (or file) is placed on the board after the dialog closed
- **Status:** CONFIRMED (failing test).
- **Evidence:**
  - Cancel/Esc calls `close()` → `editor.closePanel` (`apps/web/src/features/import/panel.tsx:115,168`).
  - `readMiro`/`pick` keep awaiting. No `AbortSignal` reaches `host.boardImport.miro`, and `placeImport` (`lib/insert.ts:88-139`) runs `editor.transact(createMany…)` when the answer arrives.
  - The server keeps reading Miro for up to 120 s and copies up to 100 pictures (`modules/importers/service.ts:87-97`). They count toward the person's quota for 24h, so cancelling and retrying spends the quota twice.
- **Test:** `apps/web/src/features/import/import.sm-audit.test.tsx`, "cancelling the import dialog while a Miro board is being read never puts that board on this one". Output: `expect(ed.getElements()).toEqual([])` failed; it received the imported shape after the dialog was already `null`.
- **Impact:** Medium. Up to 2,000 items appear live for every collaborator up to 2 minutes after an explicit Cancel.
- **Security-sensitive:** no.
- **Suggested fix:** Give the dialog an `AbortController`, pass its signal to the host fetch and to `placeImport` (which returns without writing once aborted), and stop copying on the server on `req.on('close')`. Regression test: the one above, plus a file-import variant.

#### INT-204 — A Figma token refresh or drop in flight can overwrite or delete a connection made after it started
- **Status:** SUSPECTED.
- **Evidence:**
  - `withFigmaToken` reads the account once (`modules/figma/tokens.ts:172`).
  - The refresh writes `UPDATE … WHERE user_id` (`repo.ts:51`), and the failure path does `DELETE WHERE user_id` (`tokens.ts:148,160`). Neither is conditioned on the token it read.
  - A reconnect inside one Figma round trip is overwritten with the old account's tokens, or deleted.
- **Impact:** Low (the wrong Figma account is used, or a spurious "connect again").
- **Security-sensitive:** no (it is the same person's own accounts).
- **Suggested fix:** Compare-and-set on the refresh token that was read (`AND refresh_token = $old`), or a version column. Regression test: hold the mock's `/v1/oauth/refresh`, reconnect, release, and assert the new connection is untouched.

---

#### INT-109 — An appeal arriving while the kept copy is being purged is accepted for a copy deleted a moment later
- **Status: SUSPECTED** (traced by the #192 fixer, not reproduced).
- **Evidence:** `purgeExpiredKeptCopies` reads which kept copies are under appeal before it purges, without a lock shared with `submitAppeal`; an appeal that lands in between is accepted, then its copy is purged, and it can never be granted.
- **Impact: Low.** Rating: Low.
- **Fix:** the purge re-checks the appeal under a lock (or the same per-target advisory lock the report path now uses), or `submitAppeal` re-checks the copy after insert.

#### INT-110 — A tracker OAuth token refresh in flight brings back credentials that "signed out everywhere" revoked
- **Status: CONFIRMED** (failing test, found by the #191 fixer).
- **Evidence:** the refresh path in `trackers/connections.ts` stored the new tokens unconditionally, so a refresh that started before the owner was signed out everywhere wrote working credentials back after they were cleared.
- **Impact: Low–Medium.** Rating: Low–Medium.
- **Security-sensitive:** yes (revocation not durable).
- **Fix:** store refreshed tokens only over the credentials the refresh started from; refuse to refresh revoked ones.

### Checked and fine

- **Two instances sending the same webhook delivery:** impossible while the `webhooks:deliver` advisory lock is held (`modules/webhooks/init.ts:12`, `platform/db.ts:131-152`). A tick on the same instance during a run is skipped (`heldLocks`).
- **Fan-out replay:** `UNIQUE (endpoint_id, event_id)` + `ON CONFLICT DO NOTHING` (`webhooks/repo.ts:211-214`) give one delivery per event. Test pings (NULL `event_id`) are allowed to repeat.
- **Auto-disable counting:** `markFailed` locks the endpoint row (`FOR UPDATE`) in the same tx as the delivery update (`webhooks/repo.ts:264-283`). `disabled` needs `before.enabled`, so an endpoint an admin already turned off is not "disabled by Freero" again. A success resets the streak in the same tx (`:240-249`).
- **Redelivering a delivered row:** refused (`status <> 'delivered'`, `webhooks/repo.ts:297`). Redelivering a `failed` row after max attempts gives exactly one more attempt (`service.ts:486-487`).
- **Endpoint cap:** a per-workspace `pg_advisory_xact_lock` + count + insert in one tx (`webhooks/service.ts:223-228`).
- **Endpoint deleted between fan-out read and insert:** the FK violation fails the batch, the outbox retries it, and the retry re-reads the endpoints (`platform/outbox.ts:139-147`).
- **Tracker inbound webhook redelivered / webhook and push racing:** a webhook only enqueues `link:<id>` (`trackers/service.ts:708-709`). All syncs run in the single trackers consumer (`service.ts:608-636`, lock `7_202_611_100`). `syncLink` reads both sides fresh and merges against `base`, retrying revision conflicts (`:315-325`), so a duplicate is a no-op.
- **Concurrent imports of the same issues:** `UNIQUE (board_id, connection_id, external_id)`. The loser gets `IssueAlreadyLinkedError` and skips (`trackers/service.ts:1073-1080`). The skip count is reported.
- **A card deleted locally:** the next sync removes the missing items, and with none left it deletes the link, the badge and the backlinks (`trackers/service.ts:366-381`).
- **Proposed imports:** decisions are matched by board + group + item. Linking runs only in the consumer. Accept → undo → accept is handled by the "already linked" branch (`trackers/service.ts:1419-1428`). Conflicts drop the proposal instead of double-linking.
- **Tracker OAuth `state`:** single-use `DELETE … RETURNING` with expiry (`trackers/repo.ts:589-596`).
- **Hook handshake secret:** kept only while the row is pending, fresh and without a secret (`trackers/repo.ts:675-678`). A stale pending claim is replaced with a new id, so the old registration's `keepHookSecret`/`activateHook` match nothing.
- **Revision conflicts (Azure DevOps):** re-read and re-merged up to 3 passes, then reported as a failure with a retry (`trackers/service.ts:318-324, 571-577`).
- **Outbox batch failures in the trackers/webhooks consumers:** retried 3×, then event by event (`platform/outbox.ts:132-158`). `syncLink` is idempotent, so a re-run of an already-synced link changes nothing.

- **Listing and template decisions** (approve, reject, remove, restore, feature) are single `UPDATE … WHERE status = ANY(from)` statements (`marketplace/repo.ts:127,137`, `gallery/repo.ts:132`). Two operators or a double click get 409, never a double record (`moderation/service.ts:524`). A decision on a withdrawn listing gets 404.
- **Submission quotas:** count and insert run under `pg_advisory_xact_lock` per submitter (`marketplace/repo.ts:71`, `gallery/repo.ts:70`).
- **Moderation queue:**
  - Dedupe is the partial unique index + `ON CONFLICT … WHERE status='open'` (`moderation/repo.ts:74`).
  - Resolution is a compare-and-set on `status='open'` (`repo.ts:126-133`), so a concurrent resolve and act can't both close an item or both answer the reporter.
  - Suspend and lift are compare-and-set; lifting undoes only children that weren't reversed since (`service.ts:597-622`).
  - The appeal token's MAC is bound to the action id (`:657-665`).
  - The kept-copy purge skips files that have an open upload item (`repo.ts:240-248`).
- **Problem status:** updates run under `SELECT … FOR UPDATE` (`problems/repo.ts:107`), so "fixed" is notified once. `closed_at` is kept between closed statuses and cleared on reopen. Retention re-checks `closed_at < due` in the DELETE. The screenshot attach is a compare-and-set, and the losing upload is deleted.
- **Notifications:**
  - Once means once: `UNIQUE (user_id, dedupe_key)`, never pruned.
  - Slack and email are exclusive (`claimForSlack` needs `emailed_at IS NULL`; `unclaimSlack` clears both, `notifications/repo.ts:119-129`).
  - The digest claim is an atomic `UPDATE … RETURNING`.
  - The board-change window is a compare-and-set that is moved back on failure (`boardChanges.ts:90-99`).
  - Pending mentions are taken by `DELETE … RETURNING`.
- **MCP tools:** stateless per request.
  - Write tools that aren't idempotent are declared so (`idempotentHint: false`, `mcp/tools.ts:184`).
  - `delete_items` needs `confirm: true`.
  - `propose_changes` writes only to the suggestions layer.
  - `post_status` matches and writes inside one `changeBoard` plan (`api/controlRoom.ts:245`).
  - `import_from_tracker` skips already-linked issues through the unique index (see above). `sync_to_tracker` retries are INT-3.
- **Lock keys of the moderation, problems and notifications jobs** are unique (`7_202_610_311`, `7_202_611_201`, `7_202_610_291`).
- **Slack and Figma OAuth state:** single use with expiry, in one `DELETE … RETURNING` (`slack/repo.ts:113`, `figma/repo.ts:80`), bound to the account and a browser cookie hash. A replayed callback gets 400 before any code is redeemed.
- **Slack `setLink`:** the takeover and the upsert are one tx (`slack/repo.ts:77`).
- **Slack event retries:** answered once per instance. A duplicate across instances only repeats an idempotent `chat.unfurl`.
- **Slack uninstall:** forgets the token and every link (`repo.ts:20`).
- **Figma plugin code:** an `ON CONFLICT` overwrite is harmless, because redeeming needs the PKCE verifier. Pickup is single use (`figma/repo.ts:125`). Concurrent refreshes are fine (Figma doesn't rotate refresh tokens).
- **Zoom meeting board:** the last writer wins by design, and embedding is re-checked on read. **Atlassian / Meet:** stateless.
- **Unfurl:** no server-side cache or state. A `loading` card is guarded against delete or re-point (`apps/web/src/features/embed/lib/preview.ts:70`).
- **Miro import, double submit:** the inputs are disabled while busy (`panel.tsx:171,220-227`), with a rate limit of 20/h. A picture that fails is dropped and reported, and never fails the import.

---

## Facilitation and other state stored on boards (FAC)

### Machines

#### FAC-M1 Board timer (`timer` collection, key `state` → `TimerState`)
- Defined in `packages/shared/src/ydoc.ts:260-276`. Derived phase in `features/timer/lib/timer.ts:12-26`.
- States, derived from the fields and the server clock `now`:
  - **idle**: no value; or `running=false` and `pausedRemaining` is null or ≤ 0; or `running` with `now - endsAt ≥ DONE_TTL`.
  - **running**: `running`, `endsAt` set and `now < endsAt`.
  - **paused**: `running=false` and `pausedRemaining > 0`.
  - **done**: `running` and `0 ≤ now - endsAt < 10 min`.
- Invariants:
  - `running` ⇔ `endsAt != null`.
  - `!running` ⇔ `pausedRemaining != null` (for a non-idle timer).
  - `duration ≤ MAX_DURATION`.
  - `endsAt` is on the server's clock.
  - Stop means nobody sees a timer.
- Transitions:

| from → to | trigger | guard | file:line |
|---|---|---|---|
| any → running | panel Start, `timer.start` (retro) | none (overwrites a running timer) | `timer/panel.tsx:254-255`, `timer/commands.ts:10-15` |
| running → paused | Pause | `pauseTimer` no-op unless running | `timer/panel.tsx:172`, `lib/timer.ts:33-36` |
| paused → running | Resume | `resumeTimer` no-op unless paused | `panel.tsx:170`, `lib/timer.ts:38-41` |
| running/paused → same | +1 min, music | none | `panel.tsx:174,182-183`, `lib/timer.ts:44-55` |
| running → done → idle | clock only (nothing written) | — | `lib/timer.ts:24-25` |
| any → idle | Stop (`delete`), `timer.stop` | none | `panel.tsx:175`, `commands.ts:19-23` |

Retries are idempotent locally. Concurrent writes follow Y1/Y2 (FAC-1). Clock: `app/board/serverClock.ts` (FAC-9).

#### FAC-M2 Dot vote (`voting`: `session` → `VotingSession`, `<sid>:<uid>` → ballot or sealed marker, `h:<sid>` → history)
- Defined in `ydoc.ts:278-357`. Model in `features/voting/lib/voting.ts`. Server rules in `realtime/votingRules.ts`.
- States:
  - **none**: no session.
  - **open**: `active` and (`endsAt` null or `now ≤ endsAt + 1.5 s` on the server).
  - **closing**: `active` and the deadline has passed. The server takes no ballots. The starter's client, or any editor's when the starter is gone, ends it (`lib/actions.ts:105-109`, `voting/panel.tsx:413`).
  - **ended**: `active=false` and `endedAt` set.
  - **archived**: in history, once the next start or Clear removes it.
  - A sealed vote (`anonymous`) also carries a reveal sub-state: ballots in private layers plus shared markers → revealed into the shared doc.
- Invariants:
  - One ballot per voter.
  - A ballot has at most `votesPerUser` votes and at most `maxPerItem` on one item.
  - No ballot is taken after the end or the deadline.
  - While a vote is sealed, nobody else reads the votes.
  - On end, every sealed ballot is revealed before the vote reads as ended.
  - An anonymous vote never names its voters.
- Transitions:

| from → to | trigger | guard | file:line |
|---|---|---|---|
| none/ended → open | Start, `voting.start` | `when: !session?.active` (command only); `discardPrivate` of all layers; archives the ended vote | `voting/lib/actions.ts:77-87`, `lib/voting.ts:217-241`, `commands.ts:16-30` |
| open → open | vote/unvote | client: `isOpen`, budget; server: `mayWriteBallot` | `actions.ts:57-75`, `votingRules.ts:84-97,127-166` |
| open/closing → ended | End, or the deadline | `revealPrivate` (a LayerOp) then `endSession` (a doc update) | `actions.ts:89-98`, `voting.ts:269-272` |
| any → none | Clear results | archive, then delete all | `actions.ts:111-117`, `voting.ts:275-278` |
| session changes by the same id | — | server: promise fields fixed (`mayChangeVotingSession`) | `votingRules.ts:68-77` |

#### FAC-M3 Guided retro (`retro`: `session` → `RetroSession{phase}`)
- Defined in `features/retro/lib/flow.ts:11-35`.
- States: none → write → group → vote → discuss → act → none (end). Each step drives other features through their commands.
- Invariants:
  - write ⇒ private mode and the timer are running.
  - vote ⇒ the retro's own vote is running.
  - discuss ⇒ that vote has ended.
  - `facilitated` ⇒ the retro started the facilitation session and will end it.
  - Finished means no retro bar for anyone.
- Transitions:

| from → to | trigger | guard | file:line |
|---|---|---|---|
| none → write | Start | `!getSession` | `flow.ts:71-89` |
| write→group / group→vote / vote→discuss / discuss→act | step button | `canManage` (starter or owner); reads the current phase, no expected-from | `flow.ts:92-114`, `retro/panel.tsx:120` |
| act → act | Add action item | any editor; whole session rewritten with `actionIds` | `flow.ts:125-135` |
| any → none | End / Finish, `retro.end` | any editor; `delete` | `flow.ts:137-147`, `retro/commands.ts:16-23` |

#### FAC-M4 Planning poker (`estimation`: `round` → Round{index, revealed}, `v:<round>:<item>:<user>` → marker or value)
- Defined in `features/estimation/lib/model.ts:40-63`. Actions in `lib/actions.ts`.
- States: none → picking(item i) → revealed(item i) → picking(item j) … → none.
- Invariants:
  - Picks stay sealed until the reveal.
  - The reveal moves the picks before `revealed:true`.
  - Participants write only their own pick (`realtime/estimationRules.ts`).
- Transitions:

| from → to | trigger | file:line |
|---|---|---|
| none → picking | start (`discardPrivate` of everything, delete all, set round) | `actions.ts:39-59` |
| picking → picking | pick | `actions.ts:62-77` |
| picking → revealed | reveal (LayerOp, then `revealed:true`) | `actions.ts:86-94` |
| revealed → picking | revote | `actions.ts:97-106` |
| any → item j | goTo | `actions.ts:108-120` |
| any → none | end (delete all keys) | `actions.ts:132-138` |

#### FAC-M5 Private mode (`privateMode`: `session` → `PrivateModeSession{active}`)
- Defined in `ydoc.ts:420-436`. Actions in `features/private-mode/lib/session.ts`.
- States: none → active → ended (`active:false`, kept for anonymity).
- Invariants:
  - While active, matching new content goes to the author's private layer.
  - The reveal moves everyone's drafts, then the session is ended.
  - Drafts written while anonymous stay anonymous (server stamp).
- Transitions:

| from → to | trigger | file:line |
|---|---|---|
| none/ended → active | start | `session.ts:65-76` |
| active → active | setAnonymous (whole value) | `session.ts:82-87` |
| active → ended | revealAndEnd (LayerOp, then `{...s, active:false}`) | `session.ts:96-102` |

#### FAC-M6 Facilitator controls (`facilitation`: `session` → `FacilitationSession`)
- Defined in `ydoc.ts:211-236`. Client in `features/facilitation/lib/session.ts`. Server in `realtime/facilitation.ts` and `realtime/rooms.ts:805-884`.
- States: none → running(locked / allowedTypes / follow / cursorsHidden) → none.
- Invariants:
  - Only the facilitator or the owner changes or ends it.
  - Nobody hands it to another person.
  - Limits apply to everyone except the facilitator and the owner.
  - It ends after the facilitator has been gone for `facilitatorGraceMs`.
- Transitions:

| from → to | trigger | guard | file:line |
|---|---|---|---|
| none → running | start | server: `!prev ⇒ next.by === self` | `session.ts:43-56`, `facilitation.ts:69-78` |
| running → running | change (whole value) | `by` or owner, `by` unchanged | `session.ts:58-62` |
| running → none | end; server timer | `canManage`; the timer re-checks `by` and `startedAt` | `session.ts:64-68`, `rooms.ts:868-884` |

#### FAC-M7 Presentation (`presentation`: `session` → PresentationSession, server-written only)
- Defined in `ydoc.ts:378-391`. Server in `modules/presentations/service.ts`. Client in `features/present/lib/session.ts` and `present/panel.tsx:243-266`.
- States: none → presenting(P) → presenting(Q) (handoff or takeover) → none.
- Per-client `PresentState.presenting` / `since` mirrors it.
- Invariants:
  - At most one presenter.
  - Only the presenter, the facilitator or the owner hands over or ends.
  - A takeover while P is on the board needs the facilitator or the owner.
  - The old presenter's client stops when `server.at > since`.
- Transitions: `start` / `handoff` / `end` go through `updateServerEntry`. That is a synchronous read-modify-write on this instance's room doc (`realtime/rooms.ts:2001-2017`, `presentations/service.ts:51-83`).

#### FAC-M8 Walkthrough recorder (module state `RecorderPhase` idle / starting / recording / saving, per tab)
- Defined in `features/walkthrough/lib/recorder.ts:21-68`.
- Invariants:
  - The microphone is live only while phase=recording and the recording UI is visible.
  - One recording per tab.
  - A guest's voice joins the host's session.
- Transitions:

| from → to | trigger | file:line |
|---|---|---|
| idle → starting | begin (guard `phase==='idle'`, synchronous) | `recorder.ts:154-160` |
| starting → idle (error) | `getUserMedia` / `MediaRecorder` failure | `recorder.ts:168-192` |
| starting → recording | `onstart` | `recorder.ts:197-223` |
| recording → idle/saving | stop / discard / 20-min limit / track ended / guest follows host | `recorder.ts:216,220,260-289,327-349` |
| saving → idle | upload ok or failed | `recorder.ts:295-310` |

- Server side: `walkthroughs.session_id` has a UNIQUE index (`modules/walkthroughs/migrations/202612031100_walkthrough_voices.sql:8`), and voices may arrive before or after the host's recording.

#### FAC-M9 Kanban card status vs column (implicit)
- A card's group value is the column under its centre (`packages/shared/src/fields.ts:366-369`).
- `status` follows the column's status through the kanban `arrange` pass (`features/kanban/element.tsx:703-707`).
- A regroup (`lib/group.ts:33-44`, `planGroupBy` in `packages/shared/src/layout/kanban.ts:347`) does all of this in one transaction:
  1. Writes the old group field's values onto the cards from where they stand.
  2. Makes the new field's options the columns.
  3. Moves each card to its new column.
- Invariants:
  - A card's status and its column agree.
  - A field value changes only when someone sets it.

#### FAC-M10 Card dates (implicit)
- `startDate ≤ dueDate` (`packages/shared/src/elements.ts:588`).
- Enforced by `card.setDates` (`card/commands.ts:72-74`), `setValues` (`card/lib/values.ts:57-63`) and the REST/MCP API (`apps/server/src/modules/api/items.ts:406-410`).

#### FAC-M11 Others, briefly
- **Agent pauses** (`agentPauses`: lane id → record; deleted on resume): `features/controlroom/format.tsx:11-15`. The server only reads it (`modules/api/pause.ts`).
- **Icebreaker results** (server-written, `seq`): `modules/icebreakers/service.ts:72-91`.
- **Engage results** (server-written): `modules/engage/service.ts:84-104`.
- **Call link revision** (`call`: `rev`): `features/call/panel.tsx:19-34,104`.
- **Server clock offset**: `app/board/serverClock.ts:38-79`.

---

#### Changes made by the fixes

These supersede the machine descriptions above where they differ.

- **Walkthrough recorder (M8), #194:** new transitions `starting → idle` when the board closes (devices released on arrival) or when `MediaRecorder` throws, fires `error`, or doesn't start within 10 s; `recording → idle` (discarded, with a notice) when the board closes, through `endRecordingWithBoard` from the overlay's unmount; `recording → saving` when the recorder fires `error`, keeping what was recorded. Invariant: media tracks are live only while `phase = recording` on a board that is still mounted.
- **Kanban card vs column (M9), #197:** each regroup writes the kanban's next `groupRev` (`'<n>:<field id>'`) and stamps `placed = {kanban, rev, field, key}` on the cards it moves; the layout stamps every card a change touches. New state: a card is *stale* when `placed.kanban` is this kanban and `placed.rev` isn't the current `groupRev`. Invariant: a card's group-field value is the column under it unless it is stale; a stale card's value is its stored value and its old column is its value of `placed.field`. Transitions: `stale → settled` by any layout pass (values written, card moved to its value's column); `stale → placed` when a change drops it or sets its group value (API, tracker pull, card details), recorded whether or not its position changes.
- **Card dates (M10), #197:** the toolbar's date pickers write through `card.setDates`: a due date before the start pulls the start to it, and a start after the due date isn't stored. The API checks start ≤ due only when an update sets a date.
- **Board sessions (M1–M6), #195:** every timer, retro, poker round, dot vote, facilitation and private-mode session has an `id`; starting creates a new one. Ending writes a write-once tombstone `{ id, ended: true }` under `ended:<id>` (and under the session key for timer, retro, estimation and private mode). New state on every machine: *ended (tombstone)*; "no session" means a missing value, a tombstone or a session whose id has ended. Invariant: an ended session id never becomes live again. The server enforces it (`realtime/sessionEnds.ts`, in the editor branch of `onUpdate`): `ended:` keys are write-once and well-formed, a write of an ended session is undone, and a session key left holding an ended session is set to its tombstone.
- **Sealed reveals (M2, M4, M5), #195:** the reveal and the end run in one transaction; queued layer ops (reveals only) are kept with the offline copy and flushed on connect before the client answers the server's first sync step, so reveal-then-end holds across offline and closing the tab. A reveal carries its session id (`LayerOp.session`) and never reveals a later session.
- **Guided retro (M3), #196:** a step moves only while the stored phase is still the one it moved from (`advance(editor, from)`), and the step button ignores the second click of a double click. The retro records the ids of the private-mode, vote and facilitation sessions it started and ends only those; it refuses to start a vote or private mode while someone else's is running, with a notice.
- **Server clock, #196:** the offset is re-measured after a failure (2/5/15/30/60 s) and on every reconnect; until it is measured, writers of absolute deadlines (timer start/pause/resume/+1 min, a vote with a timer) show a notice and write nothing.

### Findings

#### FAC-1: An ended session comes back when someone writes it at the same moment or offline (Stop, Finish retro, End round, Clear vote)
- **Status:** CONFIRMED for the timer and the retro (failing tests). CONFIRMED by trace for the variants in the "Same root" list below.
- **Evidence:**
  - Ending is a `Y.Map.delete` of a whole-object session value, and every other action writes the whole value back (Y2, Y3).
  - Timer: Stop `timer/panel.tsx:175` versus Pause `:172`, +1 min `:174`, or a music change `:182-183`.
  - Retro: `end` `retro/lib/flow.ts:146` versus `addAction` `:132` (any editor) or `advance` `:113` (owner).
  - Test `timer.state.test.ts` › "a timer someone stopped does not come back paused because someone else pressed Pause at the same moment (or offline)": `expected 'paused' to be 'idle'`.
  - Test `retro.state.test.tsx` › "a finished retro stays finished when a participant adds an action item at the same moment": the session is back as `{ phase: 'act', facilitated: true, actionIds:[…] }`, although `end` already ended the facilitation session it started.
  - The offline case is the same thing with a longer gap. Bob pauses while offline, Ann stops; on reconnect the paused timer comes back for everyone, whatever the client ids.
  - Same root:
    - Estimation `end` deletes the round (`estimation/lib/actions.ts:132-138`). An owner's concurrent `goTo` / `reveal` / `revote` brings the round back with its picks deleted.
    - Voting `clear` deletes the session (`voting/lib/voting.ts:275-278`). A concurrent `end` brings back an ended vote with no ballots, which is never archived.
    - Private mode `revealAndEnd` writes `{...s, active:false}` (`private-mode/lib/session.ts:100`). A concurrent `setAnonymous` writes `{...s, active:true, anonymous:true}` (`:86`). Per Y1, in about half the cases private mode is **active again after the reveal**: participants' new stickies go private again while the retro has moved on to "group".
    - Facilitation `end` (`facilitation/lib/session.ts:67`) against an owner's concurrent `change`. The server undoes the owner's write only if the delete arrives first (`realtime/facilitation.ts:75`). Otherwise the delete removes only the old item and the session, with its lock, keeps running.
- **Impact:** Medium. People see a stuck or phantom bar ("Time's up" / paused timer / retro in Act) that someone must end again. The private-mode variant hides new content from everyone without anyone choosing that.
  - Needs two people acting within one sync round, or one person offline. That is common in live sessions: the facilitator clicks End exactly when participants act.
- **Security-sensitive:** no.
- **Suggested fix:** Give each session an id and end it with a write that a stale writer cannot undo.
  - For example, keep the session and add a tombstone key `ended:<sessionId>`, or make "ended" part of a value that writers keep.
  - Writers must only write a session whose id is not ended, and readers treat a session with a tombstone as gone.
  - Do not model ending as a `delete` racing whole-object `set`s.
  - Regression tests: the two tests above, plus one for private mode `revealAndEnd` versus `setAnonymous` (both orders).

#### FAC-2: Regrouping a kanban while someone drags a card rewrites that card's field value (for example its Priority)
- **Status:** CONFIRMED (failing test).
- **Evidence:**
  - Group values are positional: `cardValue` for the group field is the column under the card's centre (`packages/shared/src/fields.ts:366-367`).
  - Elements are whole values (Y1).
  - Ann runs `setGroupBy(…, Priority)` (`kanban/lib/group.ts:33-44`). It moves card C into the "High" column and writes C's Stage value onto C, in one transaction.
  - Bob concurrently drags C into Stage column 3 ("Done").
  - When Bob's write of C wins, C stands at column 3's x under the **Priority** grouping. Its Priority now reads as whatever option is third. Its Stage value (written by Ann) is lost. The KAI-75 re-arrange (`engine/editor/arrange.ts`) only re-stacks it there.
  - Test `kanban.state.test.ts` › "regrouping a board by Priority while someone drags a card to Done never rewrites that card's priority (whichever write wins)": the Priority changed in 7 of 12 boards (`run 1: "v6UDLNxl" -> "25x4ZYDS"`, …).
- **Impact:** Medium. A card's field value changes and its old group value is lost, silently and with no undo on the other side. Needs a regroup during someone's drag, which is rare but plausible on busy boards. The same mechanism applies to a column delete or move concurrent with a drag.
- **Security-sensitive:** no.
- **Suggested fix:**
  - Don't let a stale position define a value under a grouping it wasn't written for.
  - Store the group value on the card (`values[groupField]`) and derive the column from it. Or have the arrange pass treat a card whose stored value contradicts its position after a remote regroup as "value wins, move the card".
  - Regression test: the one above.

#### FAC-3: A double click on the retro's step button skips a step
- **Status:** CONFIRMED (failing test).
- **Evidence:**
  - `advance` reads the phase at click time and has no expected-from guard (`retro/lib/flow.ts:92-114`).
  - The next step's primary button renders in the same place (`retro/panel.tsx:119-123`).
  - Test `retro.state.test.tsx` › "a double click on the step button moves the retro one step, not two": `expected 'vote' to be 'group'`.
  - From write, a double click reveals the drafts and starts the vote at once (the group step is skipped). From vote, it ends the vote and opens the act step.
- **Impact:** Low–Medium. The facilitator's flow skips a step, and the reveal and the vote end can't be undone. Double clicks on "next" buttons are common.
- **Security-sensitive:** no.
- **Suggested fix:** Pass the phase the button was rendered for (`advance(editor, from)`) and no-op when the stored phase differs. The same guard also stops two managers (starter and owner) from both running a step's side effects. Regression test: the one above.

#### FAC-4: The retro's vote step silently adopts a vote that was already running, then ends it
- **Status:** CONFIRMED (failing test).
- **Evidence:**
  - `advance` → `runCommand('voting.start', …)` (`flow.ts:104`). `runCommand` drops a command whose `when` is false without telling the caller (`engine/editor/EditorImpl.ts:1705`). `voting.start` has `when: !session?.active` (`voting/commands.ts:16`).
  - The retro still moves to `vote`. On `discuss` it runs `voting.end` on that other vote (`flow.ts:107`).
  - Same with `private-mode.start` at retro start when private mode already runs (`flow.ts:78`, `private-mode/commands.ts:7`). The retro's "group" then reveals and ends someone else's private session.
  - Test `retro.state.test.tsx` › "the retro's vote step runs the retro's own vote, never someone's vote that was still open, and doesn't end that one": the session is still "Offsite venue".
- **Impact:** Medium. A vote nobody ended (common: votes often stay open) becomes the retro's vote with the wrong items and budget, and is closed by the retro. Its results are mixed with the retro's.
- **Security-sensitive:** no.
- **Suggested fix:**
  - Have the retro check the preconditions it relies on (no running vote / private mode) at start and at each step, and ask the person to end the existing one.
  - Or record the ids of the sessions the retro itself started and only end those.
  - Regression test: the one above.

#### FAC-5: Card toolbar dates can put the start after the due date, and the card then refuses every API/MCP update
- **Status:** CONFIRMED by trace.
- **Evidence:**
  - The card format toolbar writes dates with `patchAll` → `editor.updateMany`, with no check (`card/format.tsx:13-15`).
  - The due-date input has no `min` and writes any date (`format.tsx:100`). Card with start 2026-11-10 and due 2026-11-20 → pick due 2026-11-05 → stored `startDate > dueDate`.
  - The start-date input's `max={due}` (`:108`) is only a picker hint. It is undefined when the selected cards' due dates differ, and `patchAll` then writes the start onto all of them.
  - Every other writer refuses this: `card.setDates` (`card/commands.ts:72-74`) and `setValues` (`card/lib/values.ts:57-63`).
  - Server side, `planPatch` checks `start > due` for **every** card patch using the stored dates when the patch doesn't touch them (`apps/server/src/modules/api/items.ts:406-410`). From then on any REST/MCP `update_items` on that card (title, colour, move, fields) fails 400 "startDate (…) can't be after dueDate (…)".
  - Timelines quietly ignore the start (`packages/shared/src/layout/timeline.ts:243`).
- **Impact:** Medium. The invariant is broken through the normal UI. Agents and integrations can no longer update the card until a person fixes its dates in the app. Likely: moving a due date earlier is routine.
- **Security-sensitive:** no.
- **Suggested fix:**
  - Route the toolbar's date writes through `card.setDates` (or clear or clamp the start when the due date moves before it).
  - Have the API validate the order only when the patch touches a date.
  - Regression test: set due before start through the toolbar → the stored dates keep `start ≤ due`. An API title update of a card stored with `start > due` succeeds.

#### FAC-6: Leaving the board while recording a walkthrough keeps the microphone recording with no visible control, then auto-saves it to the board you left
- **Status:** CONFIRMED by trace.
- **Evidence:**
  - Recorder state and `session` are module-level, per tab (`walkthrough/lib/recorder.ts:63,95-104`).
  - Nothing stops them when the board unmounts. The only stop calls are the overlay's buttons (`lib/Recording.tsx:202,208-209`), the 20-minute limit (`recorder.ts:216`), a track ending (`:220`) and a guest following its host (`:327-349`).
  - The overlay is a board panel (`walkthrough/panel.tsx:17`). SPA navigation to the dashboard or another board unmounts it while `MediaRecorder` keeps running.
  - With up to 20 minutes of audio (and camera), the limit timer then calls `stopRecording(true)`, which uploads to the old board through the old editor's host (`recorder.ts:294-306`).
  - On another board the overlay shows the old recording. `notePointer` records the new board's pointer into the old timeline (`Recording.tsx:168-170`, `recorder.ts:252-253`), and the camera listener is bound to the destroyed editor.
- **Impact:** Medium. The microphone or camera stays live with no stop button in Freero (only the browser's indicator), and what was said after leaving is published to the board's members without the person choosing to save it. Likely whenever someone navigates away mid-recording.
- **Security-sensitive:** yes (privacy: audio or video captured and shared after the person left, with no in-app control).
- **Suggested fix:**
  - Tie the recording to the board session: stop (discard, or save with an explicit prompt) when the walkthrough feature's board is torn down, through a feature dispose hook or an overlay unmount effect that checks `session.editor`.
  - Show a global "recording" control if it is kept.
  - Regression test: start recording on board A, destroy A's engine → phase is idle and every track is stopped.

#### FAC-7: A recorder that fails to start stays in "starting" for the life of the tab, with the microphone open
- **Status:** CONFIRMED by trace (the path is certain; the trigger is uncommon).
- **Evidence:**
  - `begin` awaits `new Promise(resolve => { recorder.onstart = resolve; recorder.start(1000); })` with no try or timeout (`recorder.ts:197-200`).
  - If `start()` throws, for example `NotSupportedError` when the stream went inactive (device unplugged or permission revoked between `getUserMedia` and `start`), the awaited promise rejects. `begin` rejects with phase `'starting'` and the tracks are not stopped.
  - If the recorder fires `error` instead of `start`, the promise never settles.
  - From then on every `begin` returns false (`:155`), and the start dialog shows a spinner forever (`Recording.tsx:32`).
- **Impact:** Low. Rare, but recording is impossible until reload and the microphone indicator stays on.
- **Security-sensitive:** no.
- **Suggested fix:** Wrap the start in try/catch with an `onerror` / timeout path that stops the tracks and returns to idle with an error. Test with a fake `MediaRecorder` whose `start` throws.

#### FAC-8: Ending a sealed vote (or revealing an estimate, or ending private mode) while not synced: the end reaches the server before the reveal, and is never followed by it if the tab closes
- **Status:** CONFIRMED by trace.
- **Evidence:**
  - `end` runs `revealPrivate` (a LayerOp) then `endSession` (a doc update) (`voting/lib/actions.ts:95-96`).
  - When not synced, the LayerOp is queued in memory (`engine/store/BoardStore.ts:441-445`) and flushed only on the provider's `sync` event (`:274-276`).
  - On reconnect the server sends sync step 1 at join (`realtime/rooms.ts:1101-1103`). The client answers with step 2, which carries the offline `endSession`, before it receives the server's step 2. Only then does it flush the reveal.
  - So the server applies "vote ended" first and reveals later. The hold that orders these online (`rooms.ts:887-912`) only holds messages sent after the op.
  - With a device copy (#178, `engine/runtime/core.ts:111-119`) the doc update is persisted (`BoardStore.ts:215-224,407-422`) but `pendingOps` are not. Close the tab before reconnecting, and on the next open the ended vote syncs without any reveal. Every ballot stays sealed in its voter's private layer, results show "N voted, 0 votes", and the next Start discards them (`actions.ts:80`).
  - The same applies to estimation `reveal` (`estimation/lib/actions.ts:92-93`: item reads revealed with no cards) and private mode `revealAndEnd` (drafts stay private; authors can share them from the leftovers bar).
- **Impact:** Medium–Low. A facilitator ending a vote on a flaky connection loses the vote's results (tab closed), or everyone briefly sees an empty result. Needs end-while-offline.
- **Security-sensitive:** no.
- **Suggested fix:**
  - Make "reveal and end" one server operation: a LayerOp that also writes the session end, or have the server reveal a session's sealed ballots when it sees that session go `active → false`.
  - Or persist pending ops with the device copy and send them before the client's step 2.
  - Regression test: an offline editor ends a sealed vote and reconnects → the server's shared doc never holds `active:false` with only sealed markers. Closing before reconnect still reveals.

#### FAC-9: A client whose clock measurement failed writes deadlines in its own skewed clock for the life of the page
- **Status:** CONFIRMED by trace.
- **Evidence:**
  - `serverNow()` = `Date.now() + offset`, with `offset` 0 until measured (`app/board/serverClock.ts:38-44`).
  - The measurement runs once per page: `started = true` before sampling (`:65-67`). If all five `HEAD /api/auth/session` samples fail (the board was opened offline from a device copy, or a network blip), `offset` stays 0 and is never retried. Before the first measurement completes (about 1 s), it is 0 too.
  - Such a client with a skewed clock writes `endsAt` for the timer (`timer/lib/timer.ts:28-31`), `endsAt` for a vote (`voting/lib/voting.ts:237`) and `startedAt` for retro / facilitation / private mode in its local clock.
  - Every other client counts down by the skew. The server enforces the vote deadline on its own clock (`realtime/votingRules.ts:80-81`), so a vote closes minutes early or late.
- **Impact:** Low–Medium. Wrong countdowns for everyone, and a vote closing early (ballots refused). Needs a skewed clock plus a failed or unfinished measurement.
- **Security-sensitive:** no.
- **Suggested fix:**
  - Retry the measurement on failure and on every socket (re)connect, ideally from the WebSocket handshake (the server can send its time).
  - For server-enforced deadlines, let the server stamp them (`endsAt = server now + duration`).
  - Test `estimateOffset` retry behaviour with failing samples.

#### FAC-10: Live activity results can be overwritten by an older snapshot when two server instances publish at once
- **Status:** SUSPECTED (multi-instance only; not reproduced).
- **Evidence:**
  - `publish` coalesces per activity only within one process (`modules/engage/service.ts:84-104`).
  - On two instances, A computes results R1 before B's answer is committed. B commits, computes R2 (both answers) and writes. A writes R1 later.
  - `writeServerCollection` writes with no recency check (`realtime/rooms.ts:1975-1994`), and two instances' concurrent sets are ordered by client id (Y1). The board can keep R1, missing B's answer, until the next answer arrives.
- **Impact:** Low (stale counts until the next change; the last answer of a poll may never show).
- **Security-sensitive:** no.
- **Suggested fix:** Recompute from the DB inside the room write, or compare `updatedAt` / a DB sequence before replacing the entry.

#### FAC-11: Two people starting a presentation on different server instances both present
- **Status:** SUSPECTED (multi-instance only).
- **Evidence:**
  - `updateServerEntry` is a synchronous read-modify-write of this instance's copy (`realtime/rooms.ts:2001-2017`). Two instances can both see no session and both accept `start` (`presentations/service.ts:53-56`).
  - The doc merge keeps one (Y1).
  - The loser's client stops only if `server.at > since` (`present/panel.tsx:261`). `since` is the loser's own start time, usually later than the winner's `at`, so it keeps presenting while the server names the other person.
- **Impact:** Low (two presenters until one stops).
- **Security-sensitive:** no.
- **Suggested fix:** Serialize presentation changes per board across instances (an advisory lock or a DB row with compare-and-set), or have the client stop whenever the server session names someone else and is newer than the client's own accepted start.

#### FAC-12: Two editors saving the board's call link at the same moment can leave one of them showing the old link
- **Status:** SUSPECTED (narrow timing).
- **Evidence:**
  - After saving, a client writes `rev = serverNow()` (`call/panel.tsx:104`) and refetches when `rev` changes (`:22-33`).
  - Alice saves, fetches (gets A), and writes rev a. Bob's save lands after Alice's fetch, and he writes rev b concurrently with a. If a wins (Y1), Alice's `rev` never changes again, so she keeps showing A while the server has B.
- **Impact:** Low.
- **Security-sensitive:** no.
- **Suggested fix:** Refetch on any remote `rev` write, not only on a value change, or store the link's version from the server response in `rev`.

---

### Checked and fine

- **Vote budget, one ballot per voter, after-end and after-deadline ballots, made-up voters, raising the budget:** undone in the same transaction by `guardVotes` (`realtime/votingRules.ts:127-166`, `takesBallots` with 1.5 s grace at `:80-81`). Two tabs of one voter write the same key, so one survives (Y1) and the voter never goes over budget.
- **Two votes started at once:** one session survives. The losing session's ballots are refused by the server (`session.id !== after.sessionId`, `votingRules.ts:88`) and ignored by readers (`ballotsOf`, `voting.ts:68-75`).
- **End of a sealed vote online:** `onLayerOp` holds the socket's later messages until the reveal is applied (`rooms.ts:887-912`), so `active:false` always lands after the reveal. Several editors ending at the deadline reveal the same ballots (the second reveal finds none).
- **Anonymous ballots:** stripped on arrival in the private layer and revealed under `anon:<n>` in content order (`votingRules.ts:158-163,186-205`).
- **Facilitation takeover / start race:** `mayChangeSession` (`realtime/facilitation.ts:69-78`) refuses a session naming someone else. The facilitator-gone timer re-checks `by` and `startedAt` before deleting (`rooms.ts:877-881`).
- **Presentation handoff vs end (single instance):** synchronous read-modify-write. An `end` after a handoff is refused 403 (`presentations/service.ts:73-78`), and a handoff after an end is refused 409.
- **Presenter leaving:** a takeover is allowed once the presenter is gone (`controlRefusal`, `service.ts:30-35`). Followers drop the follow when the presence session key changes (`present/panel.tsx:193-211`).
- **Estimation participants:** limited to their own pick of the open item (`realtime/estimationRules.ts:35-61`).
- **Agent pause vs resume at once:** set beats delete (Y2), so the lane stays paused (fails closed). The server reads pauses only from visible lanes (`modules/api/pause.ts:35-52`).
- **Icebreaker concurrent spins:** both may write the same `seq`, but every client renders only the latest value (`icebreakers/element.tsx:132-136`). No divergence.
- **Kanban concurrent drops into one column:** KAI-75 re-arrange by one client (`engine/editor/arrange.ts`, existing test `kanban.test.ts:357`). A card's status and position written in one gesture are one element value, so concurrent drags of one card never mix one writer's column with another's status (FAC-2 is the regroup case).
- **Timeline range:** `setRange` refuses `end < start` (`timeline/lib/actions.ts:42`). Concurrent range edits replace the whole element (Y1), so `start ≤ end` holds.
- **Walkthrough double start / double save:** the phase is checked before the first await (`recorder.ts:155`). `stopRecording` checks the phase (`:262`). The UNIQUE `session_id` index refuses a second walkthrough for one session. Voices are accepted before or after the host's save, and orphans are dropped (`walkthroughs/service.ts:286-325`).
- **Recorder permission denied:** falls back to voice only, else idle with an error message (`recorder.ts:168-182`).
- **Decision delete twice:** `DELETE … RETURNING` makes it idempotent (`decisions/repo.ts:69-70`).
- **Meeting-notes import:** `busy` disables a second import (`meeting-notes/panel.tsx:19-31`). There is no recorder state machine in that feature; RecorderPhase is the walkthrough recorder (M8).


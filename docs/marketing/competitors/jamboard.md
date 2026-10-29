# Freero as a Jamboard alternative — competitor fact sheet

Slug: `jamboard` · Facts checked 2026-10-28 · Freero facts from the internal Freero brief (repo paths cited below).

> Framing: Google Jamboard is **discontinued**. The app stopped allowing edits on Oct 1, 2024 and shut down on Dec 31, 2024. The 55-inch device lost its license, management and updates on Sept 30 to Oct 1, 2024. This page targets people still searching for a replacement, especially teachers. Use past tense for Jamboard.

## 1. What it was and who it was for

Jamboard was Google's simple collaborative whiteboard. It had two parts. One was a 55-inch 4K touchscreen device for meeting rooms and classrooms, announced Oct 25, 2016 and sold from May 2017. The other was a free companion app on the web, iOS and Android, open to anyone with a Google account (https://en.wikipedia.org/wiki/Jamboard; https://venturebeat.com/business/google-starts-selling-4k-digital-whiteboard-jamboard-for-4999-in-the-u-s, checked 2026-10-28). A "jam" was a short deck of frames with pens, sticky notes, images, shapes and a laser pointer, and it was saved to Google Drive. It was popular in schools as a no-setup, Google-Classroom-friendly board. The device was aimed at businesses on G Suite (later Google Workspace).

## 2. Pricing (historical; nothing can be bought today)

| Item | Price | Source (checked 2026-10-28) |
|---|---|---|
| Jamboard 55" device (2017 launch, US) | $4,999 (incl. two styluses, eraser, wall mount) | https://venturebeat.com/business/google-starts-selling-4k-digital-whiteboard-jamboard-for-4999-in-the-u-s |
| Rolling stand | $1,349 | same |
| Annual management & support fee | $600/device/year ($300 off year one for orders by Sept 30, 2017) | same |
| Education customers | One-time $600 management and support fee instead of annual (reported from Google's former product page) | https://petri.com/googles-jamboard-will-cost-4999-plus-600-yearly-maintenance-fee (search snippet; page returned 403) |
| Jamboard app (web, iOS, Android) | No separate charge; available to Google account / Workspace users | https://en.wikipedia.org/wiki/Jamboard |
| License renewals Oct 1, 2023 to Sept 30, 2024 | Prorated to end Sept 30, 2024 | https://support.google.com/jamboard/answer/14011742 |

Currency USD. No per-seat pricing existed for the app.

## 3. AI and agent capabilities

- The device had internet-dependent drawing aids, which Google's end-of-life page calls the "AI drawing tool." After Oct 1, 2024 these stopped working on unlicensed devices (https://support.google.com/jamboard/answer/14011742, checked 2026-10-28).
- No public API for jam content, no MCP server and no agent access was found. The product predates those features and is now shut down.

## 4. Self-hosting and licensing

- Proprietary Google cloud service. It was never open source or self-hostable.
- After end of life, a device can still be used **offline** as a basic whiteboard (factory reset, then "Skip Activation") or as an HDMI display. It cannot save to Drive or join Meet (https://support.google.com/jamboard/answer/14011742).

## 5. Enterprise features (historical)

- Devices were managed from the Google Admin console (Jamboard Fleet Management) until Oct 1, 2024, when all Jamboard settings were removed (https://support.google.com/jamboard/answer/14011742).
- Identity and data controls came from the Google Workspace account. Nothing about Jamboard-specific SSO, SCIM, audit or residency was documented separately. **Not verified** beyond Workspace generalities.

## 6. Integrations relevant to Freero's differentiators

- Jira / Linear / GitHub: none (no evidence found that any existed).
- Google's own integrations: Drive storage and Google Meet on the device. Its stated successors, FigJam, Lucidspark and Miro, integrate with Meet, with Calendar and Drive integration planned (https://workspace.google.com/blog/product-announcements/next-phase-digital-whiteboarding, checked 2026-10-28).

## 7. Where Jamboard was genuinely stronger than Freero (historically)

- **Purpose-built hardware:** a 55-inch 4K touch display with camera, microphones and speakers, plus stylus and eraser (https://en.wikipedia.org/wiki/Jamboard). Freero is software only, with no built-in audio or video (`docs/configuration.md` "Board calls").
- **Google Workspace fit:** jams lived in Drive, opened from Meet and needed no IT setup for schools already on Google. Freero has Google sign-in (OIDC) but no Drive or Classroom integration (brief: not claimed).
- **Simplicity for young students:** a deliberately small toolset. Freero is a much larger product, which can be more to learn.
- **Native mobile apps** (iOS, Android). Freero is a PWA with a view-and-comment phone layout (`docs/accessibility.md`).
- **Zero ops:** hosted by Google, while Freero needs someone to run it unless a hosted offer exists.

## 8. Where Freero is stronger (verifiable)

| Freero point | Freero source | Jamboard contrast |
|---|---|---|
| It's still running and actively developed | `README.md` | App shut down Dec 31, 2024 (https://workspaceupdates.googleblog.com/2023/09/the-next-phase-of-digital-whiteboarding-for-google-workspace.html) |
| You can own it: MIT licence, self-host on your own server or school infrastructure, so no vendor can switch it off | `LICENSE`, `docs/deployment.md` | Google retired the app and device on its own timeline (same source) |
| Free with no plan gates, no per-seat fee, and no hardware to buy | `docs/parity.md` §13 | The device cost $4,999 plus a $600/year fee (https://venturebeat.com/business/google-starts-selling-4k-digital-whiteboard-jamboard-for-4999-in-the-u-s) |
| Guests join a shared board with just a name, no account | `ARCHITECTURE.md` "Guests" | Not compared: no Jamboard source found on guest access |
| Classroom facilitation: voting, shared timer, polls, word clouds, Q&A, presentation mode, private mode | `docs/configuration.md` (RATE_LIMIT_ENGAGE), `apps/web/src/features/engage` | Jamboard had pens, notes, images and frames only (https://en.wikipedia.org/wiki/Jamboard) |
| Infinite canvas instead of fixed frames; frames still available and exportable to PDF | `README.md` | Jams were frame-based (same) |
| Accessibility: keyboard operation, screen-reader "Board as list", high-contrast support, WCAG 2.1 AA target | `docs/accessibility.md` | No Jamboard accessibility statement found |
| AI agents and MCP, tracker sync, REST API, SSO/SCIM for schools and teams that need them | `docs/mcp.md`, `docs/trackers.md`, `docs/configuration.md` | None existed |

**Migration reality (be explicit on the page):**
- Freero has **no Jamboard importer** (brief "Honest gaps").
- What survives from Jamboard is PDFs. Google's help page now says jams were converted to PDFs in 2025 and are available in Google Drive, where you can find them with the search `type:Jam` and download them as PDF, or PNG for single frames (https://support.google.com/jamboard/answer/14084927, checked 2026-10-28). Google's original 2023 notice said jams would be permanently deleted after Dec 31, 2024, and universities repeated that warning (https://workspaceupdates.googleblog.com/2023/09/the-next-phase-of-digital-whiteboarding-for-google-workspace.html; https://kb.wisc.edu/helpdesk/news.php?id=13651). Recommend users check Drive.
- Freero can place PDFs and images on a board (`README.md`: PDFs, images). Content comes in as a document or picture, not as editable sticky notes. FigJam lists a Jamboard importer (https://help.figma.com/hc/en-us/articles/1500007927941), so it is the more direct path for anyone who needs editable notes.

## 9. Suggested comparison table

| Capability | Jamboard | Freero | Sources |
|---|---|---|---|
| Availability / status | Retired (app shut down Dec 31, 2024) | Yes | https://workspaceupdates.googleblog.com/2023/09/the-next-phase-of-digital-whiteboarding-for-google-workspace.html; `README.md` |
| Free tier | No (Retired; was free app) | Yes | https://en.wikipedia.org/wiki/Jamboard; `docs/parity.md` §13 |
| Price per seat | No (device $4,999 + $600/yr, historical) | No (free) | https://venturebeat.com/business/google-starts-selling-4k-digital-whiteboard-jamboard-for-4999-in-the-u-s; `LICENSE` |
| Open source licence | No | Yes (MIT) | Google proprietary; `LICENSE` |
| Self-hosting | No | Yes | https://support.google.com/jamboard/answer/14011742; `docs/deployment.md` |
| MCP / agent access | No | Yes | none existed; `docs/mcp.md` |
| Agent write access with human review | No | Yes | none existed; `docs/mcp.md` |
| Built-in AI | No (device drawing aid only; Retired) | Partial (operator configures a model) | https://support.google.com/jamboard/answer/14011742; `docs/ai.md` |
| Bring-your-own AI model | No | Yes | none existed; `docs/ai.md` |
| Jira / Linear / GitHub two-way | No | Yes | none existed; `docs/trackers.md` |
| REST API | No | Yes | none found; `docs/api/openapi.json` |
| Webhooks | No | Yes | none found; `docs/events.md` |
| SSO | No (Retired; was Google account sign-in) | Yes | https://en.wikipedia.org/wiki/Jamboard; `docs/configuration.md` |
| SCIM | No | Yes | none found; `docs/configuration.md` |
| Audit log | No (device event logs deleted after Sept 30, 2024) | Yes | https://workspaceupdates.googleblog.com/2023/09/the-next-phase-of-digital-whiteboarding-for-google-workspace.html; `ARCHITECTURE.md` |
| Data residency choice | No | Yes (self-host anywhere) | Google cloud only; `docs/deployment.md` |
| Native apps | No (iOS/Android apps Retired) | No (PWA) | https://workspaceupdates.googleblog.com/2023/09/the-next-phase-of-digital-whiteboarding-for-google-workspace.html; `apps/web/public/manifest.webmanifest` |
| Templates | No (none found) | Yes (73) | https://en.wikipedia.org/wiki/Jamboard; templates catalog |
| Guest access | No (Retired) | Yes | app shut down per Google 2023 notice; `ARCHITECTURE.md` "Guests" |
| Accessibility statement | No (none found) | Yes | none found on support.google.com/jamboard; `docs/accessibility.md` |
| Physical whiteboard hardware | No (device Retired; offline-only use) | No | https://support.google.com/jamboard/answer/14011742; brief |

## 10. Target search keywords

- **Jamboard alternative** (primary)
- **Jamboard replacement** (primary)
- **free Jamboard alternative for teachers** (primary)
- Google Jamboard discontinued
- what happened to Jamboard
- Jamboard shut down
- where are my Jamboard files
- Jamboard files PDF Google Drive
- open Jamboard files after shutdown
- Jamboard alternative for students
- self-hosted Jamboard alternative
- open source Jamboard alternative
- Jamboard device after end of life

## 11. Notable timely context

- 2016-10-25 — Jamboard announced. 2017-05-23 — US sales start at $4,999 (https://venturebeat.com/business/google-starts-selling-4k-digital-whiteboard-jamboard-for-4999-in-the-u-s).
- 2023-09-28 — Google announced the wind-down. Whiteboarding moved to partners FigJam, Lucidspark and Miro, with Meet integration available and Calendar/Drive integration planned. Google promised a migration path to those three and compensation for education device owners (https://workspace.google.com/blog/product-announcements/next-phase-digital-whiteboarding; https://9to5google.com/2023/09/28/google-jamboard/).
- 2023-10-01 to 2024-09-30 — device licenses renewable only prorated to Sept 30, 2024 (https://support.google.com/jamboard/answer/14011742).
- 2024-09-30 — device licenses ended; no more security or feature updates (AUE). Admins had to back up device event logs before this date (same; https://workspaceupdates.googleblog.com/2023/09/the-next-phase-of-digital-whiteboarding-for-google-workspace.html).
- 2024-10-01 — app became view-only (no new or edited jams on any platform). Fleet Management shut down and devices went unlicensed (same sources).
- 2024-12-31 — app shut down on web, iOS, Android and Meet devices. This was also the export deadline (Google 2023 notice).
- 2025 — Google's help page now says jams were converted to PDFs in 2025 and remain in Drive (https://support.google.com/jamboard/answer/14084927). This differs from the original "permanently deleted" wording. Exact conversion date not given.
- Partner importers were reported for FigJam, Lucidspark and Miro. FigJam's help lists Jamboard as an import source (https://help.figma.com/hc/en-us/articles/1500007927941). Lucidspark and Miro import paths were described via PDF (https://edutopia.org/article/replacements-for-google-jamboard, 2023-11-28).

## Sources (all checked 2026-10-28)

- https://workspaceupdates.googleblog.com/2023/09/the-next-phase-of-digital-whiteboarding-for-google-workspace.html
- https://workspace.google.com/blog/product-announcements/next-phase-digital-whiteboarding
- https://support.google.com/jamboard/answer/14084927
- https://support.google.com/jamboard/answer/14011742
- https://9to5google.com/2023/09/28/google-jamboard/
- https://venturebeat.com/business/google-starts-selling-4k-digital-whiteboard-jamboard-for-4999-in-the-u-s
- https://petri.com/googles-jamboard-will-cost-4999-plus-600-yearly-maintenance-fee (403; search snippet only)
- https://en.wikipedia.org/wiki/Jamboard
- https://kb.wisc.edu/helpdesk/news.php?id=13651
- https://help.figma.com/hc/en-us/articles/1500007927941
- https://edutopia.org/article/replacements-for-google-jamboard

## Could not verify

- Exact date in 2025 when Google converted jams to PDFs, and whether every jam was converted ("best effort" is reported by secondary sources only).
- Whether Miro's and Lucidspark's dedicated Jamboard importers still exist today. Only FigJam's help page lists one.
- The education one-time $600 fee (only a search snippet; the source page returned 403).
- Whether Jamboard had guest or anonymous sharing or an accessibility statement (none found). The "Guest access" and "Accessibility statement" cells are marked No for lack of evidence.
- Freero: status and pricing of "the hosted service" mentioned in `docs/mcp.md`. Do not claim a hosted Freero offer.

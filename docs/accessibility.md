# Accessibility

Freero aims at **WCAG 2.2 level AA** for the app chrome (dashboard, settings, admin console,
dialogs, menus) and for the board itself as far as a free-form canvas allows. This page is the
working record behind the conformance report on the site (`/accessibility`, a VPAT 2.5 WCAG
edition, a self-assessment until an external audit): what is supported, how it is checked, and the
known gaps. Keep both current when a change affects keyboard, screen-reader, colour, motion,
target size or pointer behaviour.

## How it is checked

- **Automated: `npm run a11y`** (`scripts/a11y.mjs`, #141). axe-core 4.14 (MPL-2.0, a dev
  dependency, unmodified) in headless Chromium against the real app — a production build served
  by a real server, or `--base` for one already running — with WCAG 2.0, 2.1 and 2.2 A / AA rules
  plus axe's best practices, in 17 states: sign-in and sign-up; the dashboard; account settings;
  the admin console; a board idle and with a selection (its format toolbar); the share dialog; the
  board menu; the timer; the shortcut sheet; the walkthrough dialog; presenting; the dashboard and a
  board in the dark theme; the dashboard and a board at phone width. It fails on any *serious* or
  *critical* violation and lists moderate ones. Beside axe it checks with the keyboard that the
  share dialog keeps focus inside and gives it back to Share when it closes, and that F6 reaches the
  board's regions. Last run (2026-11-03, #141): no violations of any impact.
- **Unit tests** guard the behaviours most likely to regress: the keyboard walk order (a frame's
  items right after the frame), Alt+arrow spatial jumps, Alt+Shift+arrow resizing as one undo step,
  Enter-to-place with a creation tool, the live-region wording and its throttling, the camera
  jumping instead of gliding under reduced motion, readable avatar initials, touch routing, menus
  and selects taking focus as they open, and tooltips that stay under the pointer and close on
  Escape (1.4.13).
- **Manual / browser (2026-11-03, #141):** keyboard-only passes driven with Playwright on the
  dashboard, a board, the share dialog, account settings and presenting; the accessibility tree
  Chromium exposes (names, roles, states) read for the same flows; reflow at 320 CSS px and the
  WCAG text-spacing override on the dashboard, account settings and sign-in; forced colours and
  reduced motion emulated in Chromium; iPad / iPhone / Pixel emulation. **Not yet done:** a pass
  with real screen readers (NVDA, JAWS, VoiceOver, TalkBack) and with speech input. That, and an
  independent audit, are the owner's next step before the report can say more than
  "self-assessment".

## WCAG 2.2: the new criteria

| Criterion | Where Freero stands |
|---|---|
| 2.4.11 Focus Not Obscured (Minimum) | Supports. Keyboard focus on the board moves the selection into the safe area (clear of toolbars, docks and the filmstrip); dialogs and popovers take focus inside themselves. |
| 2.5.7 Dragging Movements | Partially supports. Items move and resize with the keyboard (arrows, Alt+Shift+arrows) and through menus; slides reorder from their menu ("Move slide earlier / later", #141). Freehand drawing and freeform connector paths have no single-pointer alternative beyond placing default shapes and straight lines. |
| 2.5.8 Target Size (Minimum) | Supports in the chrome (controls 32 px, 40 px on touch; axe's target-size rule passes). Fixed in #141: a long board menu squeezed its items to 17 px; it now scrolls. Board items are the author's size. |
| 3.2.6 Consistent Help | Supports. The Help menu (shortcuts, Report a problem, support) sits at the top right of the dashboard, account settings and the admin consoles (added there in #141), and in the bottom-right corner of every board. |
| 3.3.7 Redundant Entry | Supports. Nothing is asked twice in one process, except a new password being confirmed (allowed for security). |
| 3.3.8 Accessible Authentication (Minimum) | Supports. Email and password fields carry `autocomplete`, paste and password managers work, two-step codes accept one-time-code autofill, and sign-in with Google, Microsoft or SSO needs no memory test; there is no CAPTCHA. |

## Fixed in the 2.2 review (#141)

- Label in Name (2.5.3): selects, the format toolbar's value buttons (font, size), the zoom
  percentage, the presence avatars, the workspace switcher and the account button were named
  differently from what they show; each is now named by its visible text plus what it does.
- Name, Role, Value (4.1.2): at phone and tablet widths the dashboard's navigation and the board's
  Share button hid their labels with `display: none`, leaving buttons without names; the labels are
  now visually hidden instead.
- Contrast (1.4.3): the dark theme's primary colour on its soft fill (active navigation, the timer
  pill) measured 4.3:1; it is now 4.9:1. Text on the warning fill (the "confirm your email" banner,
  the timer's last ten seconds) was a fixed brown, unreadable in the dark theme and 4.3:1 on the
  timer in the light one; it is a token now (`--fr-warning-ink`, 5.8:1 light, 6.5:1 dark).
- Keyboard (2.1.1): the shortcut sheet's scrolling list wasn't reachable by keyboard; it is a
  focusable region.
- Reflow (1.4.10): at 320 CSS px the dashboard's "create" tiles and the account photo controls
  ran out of their column, and a long email address out of its banner.
- Content on Hover (1.4.13): tooltips vanished as the pointer moved onto them and couldn't be
  dismissed without moving; they now stay while hovered and close on Escape.
- Dragging Movements (2.5.7) and Target Size (2.5.8): see the table above.
- Consistent Help (3.2.6): the admin and organisation consoles now carry the Help menu too.
- The board menu is a named dialog; the floating format toolbar is inside a landmark.

## Keyboard

Everything on the board works without a pointer. The `?` sheet lists every binding (it is built
from the live registry, so it cannot drift).

| Keys | What it does |
|---|---|
| Tab / Shift+Tab | From the canvas: select the next / previous item in reading order. A frame's items come right after the frame. Selection is brought into view. |
| Alt+←↑→↓ | Select the nearest item in that direction. |
| ←↑→↓ (Shift: ×10 or 5 grid lines) | Move the selection. A burst is one undo step. |
| Alt+Shift+←↑→↓ | Resize the selection (one grid line with snap on, else 10 px), the way its handles would. |
| Enter | Edit the selected item's text. With a creation tool picked (N, T, S, C…): place a new item next to the selection. |
| Escape | Stop editing → whole group → deselect. From a toolbar: back to the canvas. |
| Shift+F10 / Menu key | The context menu of the selection (or of the board). |
| Alt+F10 | Focus the format toolbar; ←/→, Home/End move along it. |
| F6 / Shift+F6 | Move focus between the canvas, the tools, the board header, people & sharing, the format toolbar, an open side panel and the view controls. |
| Alt+Shift+L | **Board as list**: the whole board as a tree (see below). |
| Mod+/ or Mod+K | Command palette (every action, with why it is unavailable). With one item selected, Mod+K is "Link to…"; while typing, a text link. |
| Shift+1 / Alt+1, Shift+2 / Alt+2, Shift+0 / Mod+0 | Zoom to fit, zoom to the selection, zoom to 100%. |
| Mod+] / Page Up, Mod+[ / Page Down | Bring to front, send to back (a selected PDF turns its pages instead). |

Aliases (Mod+K, Alt+1, Alt+2, Mod+0, Page Up / Down) match the keys people bring from other
whiteboards. An alias never overrides a command whose own key it is, and a key that types a
character while you write (Option+1 is "¡" on a Mac) types it. Alt+arrows stay item navigation.

Tab on the canvas walks items rather than leaving the canvas (as in other whiteboards); F6 is the
documented way between regions, and the canvas' accessible description says so (WCAG 2.1.2).

## Screen readers

- The canvas is an `application` region ("whiteboard") named after the board, with instructions as
  its description.
- A polite live region reads every selection change: type, text, place in the walk and frame —
  "Sticky note: Ship on Friday. 2 of 14, in Frame: Retro." Several items: "3 items selected".
  Names come from each type's `label` and `toPlainText` (`describeElement`), so new item types are
  spoken correctly without extra work.
- A second live region reports collaborators: joins and leaves (gathered for 1.5 s) and their edits
  (gathered for at least 3 s, at most one announcement per 10 s: "Ana changed 4 items."). Nothing
  that arrives with the first sync, and never your own edits or undo.
- **Board as list** (`features/board-list`) shows the board's semantic outline — the same read model
  agents use (`Editor.getOutline`) — as an ARIA tree with one tab stop: frames and clusters with
  their items in reading order, votes, tags and comment counts, and connections as "A → B". Enter
  shows the item on the canvas.
- Chrome controls have accessible names; dialogs are modal with focus kept inside and restored on
  close; menus and popovers move focus to their content and back.

## Colour, contrast, focus

- Muted text (`--fr-ink-3`) and the danger colour meet 4.5:1 on every surface token.
- Avatar initials and collaborator labels pick the ink with the higher contrast on the person's
  colour (black where neither the dark ink nor white reaches 4.5:1).
- Keyboard focus is a solid 2 px ring with a light gap (`--fr-focus-ring`), on the canvas an inset
  ring; it never relies on colour alone.
- **Windows high contrast / `forced-colors: active`:** selection boxes, handles, the pressed tool,
  focus and primary buttons use system colours (`Highlight`, `CanvasText`); chrome cards get
  borders because shadows are dropped.

## Motion

With `prefers-reduced-motion: reduce`, every CSS animation and transition finishes at once, and the
camera jumps instead of gliding (zoom, fit, Tab-walking, minimap, following someone).

## Touch and small screens

- Tablets: pinch zoom, one finger pans empty canvas, long press opens the context menu, bigger
  handles and 40 px controls on coarse pointers, palm rejection while a pen is down and "pen draws,
  finger pans" once a pen was used.
- Phones (≤ 600 px): a view-and-comment layout — bottom bar with select, hand and comment, comments
  as a bottom sheet, the full toolbar behind "Edit board" for editors. No control overflows at
  390 px.

## Known gaps

- Board items are not individual DOM focus targets: the canvas keeps focus and the live region reads
  the selection (screen readers in browse mode don't see items; the Board-as-list tree is the way to
  read the board). Text inside rich-text items is read when editing starts.
- The canvas can't express spatial relations (overlap, distance) beyond reading order, frames and
  connectors.
- Drawing (pen, highlighter) and freehand connectors need a pointer; they have no keyboard
  equivalent beyond placing default shapes / lines.
- Colour pickers rely on swatch colour plus a tooltip name; in forced colours the swatch fill
  itself is dropped (the control stays reachable and named).
- Freehand drawing and freeform connector paths need a pointer (2.5.7).
- Not yet checked with real screen readers or speech input, nor audited independently.
- Third-party embeds (video players) follow their providers' accessibility.
- Item content that people write (sticky colours, text contrast on custom fills) is not checked.

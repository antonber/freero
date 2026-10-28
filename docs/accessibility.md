# Accessibility

Freero aims at **WCAG 2.1 level AA** for the app chrome (dashboard, settings, admin console,
dialogs, menus) and for the board itself as far as a free-form canvas allows. This page is the
basis for a VPAT: what is supported, how it is checked, and the known gaps. Keep it current when a
change affects keyboard, screen-reader, colour or motion behaviour.

## How it is checked

- **Automated:** axe-core (run through Playwright against a real session) on the dashboard, a board
  (idle, with a selection and its format toolbar, the context menu, the board list, the shortcut
  sheet, the share dialog), the template picker, account settings, the admin console and the
  sign-in page. Target: no *serious* or *critical* violations. Last run (KAI-108): none; only
  *moderate* "region" findings remain for floating board chrome (see gaps).
- **Unit tests** guard the behaviours most likely to regress: the keyboard walk order (a frame's
  items right after the frame), Alt+arrow spatial jumps, Alt+Shift+arrow resizing as one undo step,
  Enter-to-place with a creation tool, the live-region wording and its throttling, the camera
  jumping instead of gliding under reduced motion, readable avatar initials, and touch routing.
- **Manual / browser:** keyboard-only flows driven with `scripts/ui-shot.mjs` (no mouse), forced
  colours and reduced motion emulated in Chromium, iPad / iPhone / Pixel emulation.

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
| Mod+/ | Command palette (every action, with why it is unavailable). |

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
- Floating board chrome is outside landmarks in a few states (axe "region", moderate).
- Third-party embeds (video players) follow their providers' accessibility.
- Item content that people write (sticky colours, text contrast on custom fills) is not checked.

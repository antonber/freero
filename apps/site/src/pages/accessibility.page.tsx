// Freero's Accessibility Conformance Report (#141): the structure of the VPAT 2.5 WCAG edition
// (product information, evaluation methods, terms, a table per conformance level), written from our
// own review of 2026-11-03 — `npm run a11y` (axe-core in a real session) and the manual passes in
// docs/accessibility.md. A self-assessment: it stays `underReview` (shown as a draft and kept noindex
// by the server) until the owner approves it, and says so until an independent audit replaces it.
// Keep it in step with docs/accessibility.md.
import type { ReactNode } from 'react';
import { Table } from '../components/ui';
import { definePage } from '../lib/define';
import { L, LegalArticle } from '../lib/legal';
import { abs, docsUrl, SOURCE_REPO } from '../lib/site';

const UPDATED = '2026-11-03';

type Level = 'Supports' | 'Partially Supports' | 'Does Not Support' | 'Not Applicable';
type Row = [criterion: string, level: Level, remarks: ReactNode];

const LEVEL_A: Row[] = [
  ['1.1.1 Non-text Content', 'Partially Supports', 'Controls and icons have text names; decorative icons are hidden. Pictures people put on boards carry the alt text their author gives them (Alt text in the image toolbar), which is empty unless they do.'],
  ['1.2.1 Audio-only and Video-only (Prerecorded)', 'Partially Supports', 'Walkthroughs (a recorded voice over the live board) can have captions, typed by their author or made by the board’s AI provider; a walkthrough without them has no text alternative. Audio and video files people upload are their content.'],
  ['1.2.2 Captions (Prerecorded)', 'Partially Supports', 'As 1.2.1: walkthrough captions exist when the author adds them; they name the speaker when several people present.'],
  ['1.2.3 Audio Description or Media Alternative (Prerecorded)', 'Partially Supports', 'A walkthrough’s picture is the live board, which a screen reader can read as a list (Board as list); the narrator’s view moving is not described.'],
  ['1.3.1 Info and Relationships', 'Partially Supports', 'The app’s chrome uses headings, landmarks, lists, labelled fields and ARIA roles. On the board, structure is exposed through reading order, frames and connectors (and Board as list), but overlap and distance between items are not.'],
  ['1.3.2 Meaningful Sequence', 'Supports', 'Tab and Board as list walk the board in reading order, a frame’s items right after the frame.'],
  ['1.3.3 Sensory Characteristics', 'Supports', 'Instructions name controls, not only their shape, colour or place.'],
  ['1.4.1 Use of Color', 'Partially Supports', 'Colour pickers name each colour in a tooltip and the selected one is marked by a check; meaning people give to colours on their boards (a red sticky) is their content.'],
  ['1.4.2 Audio Control', 'Supports', 'Sound plays only when someone starts it: the timer’s background music can be muted and its volume set by each person, and the end-of-timer chime is short and can be muted.'],
  ['2.1.1 Keyboard', 'Partially Supports', 'Everything in the chrome, and selecting, moving, resizing, editing, connecting and placing items on the board, works from the keyboard. Freehand drawing needs a pointer.'],
  ['2.1.2 No Keyboard Trap', 'Supports', 'Tab walks items on the board as in other whiteboards; F6 and Shift+F6 leave the canvas for the other regions, and the canvas’s description says so.'],
  ['2.1.4 Character Key Shortcuts', 'Supports', 'Single-key tool shortcuts work only while the board has focus and never while typing; the shortcut sheet lists them.'],
  ['2.2.1 Timing Adjustable', 'Supports', 'The shared timer is set and extended by the people running the session (+1 min, pause); nothing signs anyone out or ends their work on a time limit they can’t extend, except session limits a workspace administrator chooses.'],
  ['2.2.2 Pause, Stop, Hide', 'Supports', 'Animations are short; with reduced motion they finish at once. Playback of walkthroughs and media has its own controls.'],
  ['2.3.1 Three Flashes or Below Threshold', 'Supports', 'Nothing flashes more than three times a second (the timer’s end flashes four times over three seconds, and not at all with reduced motion).'],
  ['2.4.1 Bypass Blocks', 'Supports', 'Landmarks on every page; on a board, F6 moves between its regions.'],
  ['2.4.2 Page Titled', 'Supports', 'Each page’s title names it (a board’s title is its name).'],
  ['2.4.3 Focus Order', 'Supports', 'Focus follows reading order; dialogs and menus take focus when they open and give it back when they close (checked by npm run a11y for the share dialog).'],
  ['2.4.4 Link Purpose (In Context)', 'Supports', 'Links say where they go.'],
  ['2.5.1 Pointer Gestures', 'Supports', 'Pinch zoom has the zoom buttons and keys; multi-finger gestures are never the only way.'],
  ['2.5.2 Pointer Cancellation', 'Supports', 'Buttons and menu items act on release, not on press.'],
  ['2.5.3 Label in Name', 'Supports', 'Fixed in this review: selects, the format toolbar’s font and size buttons, the zoom percentage, avatars, the workspace switcher and the account button are named by what they show.'],
  ['2.5.4 Motion Actuation', 'Not Applicable', 'Nothing responds to moving the device.'],
  ['3.1.1 Language of Page', 'Supports', 'The page’s language is the interface language (ten languages, two of them right to left).'],
  ['3.2.1 On Focus', 'Supports', 'Focus never changes the context on its own.'],
  ['3.2.2 On Input', 'Supports', 'Changing a setting does what its label says; nothing navigates away on input. Choosing another interface language reloads the page in that language.'],
  ['3.2.6 Consistent Help', 'Supports', 'The Help menu sits in the same place on the dashboard, in account settings and in the admin consoles (added there in this review), and in the same corner on every board.'],
  ['3.3.1 Error Identification', 'Supports', 'Field errors are shown in text beside the field.'],
  ['3.3.2 Labels or Instructions', 'Supports', 'Fields have visible labels; formats are explained (for example mm:ss on the timer).'],
  ['3.3.7 Redundant Entry', 'Supports', 'Nothing is asked twice in one process except confirming a new password.'],
  ['4.1.1 Parsing', 'Not Applicable', 'Removed from WCAG 2.2 (always satisfied for HTML).'],
  ['4.1.2 Name, Role, Value', 'Supports', 'Controls expose their name, role and state (pressed, expanded, selected). Fixed in this review: buttons whose labels were hidden at phone width had no name.'],
];

const LEVEL_AA: Row[] = [
  ['1.2.4 Captions (Live)', 'Not Applicable', 'Freero carries no live audio or video; calls happen in the meeting tool people link to a board.'],
  ['1.2.5 Audio Description (Prerecorded)', 'Partially Supports', 'As 1.2.3.'],
  ['1.3.4 Orientation', 'Supports', 'Works in portrait and landscape; phones get a layout of their own.'],
  ['1.3.5 Identify Input Purpose', 'Supports', 'Name, email, password and one-time-code fields carry autocomplete purposes.'],
  ['1.4.3 Contrast (Minimum)', 'Supports', 'Text in the app meets 4.5:1 in the light and dark themes (fixed in this review: the dark theme’s primary colour on its soft fill was 4.3:1, and text on the warning colour was unreadable in the dark theme). Colours people choose for their own board content aren’t checked.'],
  ['1.4.4 Resize Text', 'Supports', 'Browser zoom to 200% keeps everything usable; the board zooms its content on its own.'],
  ['1.4.5 Images of Text', 'Supports', 'Text is text, except the logo.'],
  ['1.4.10 Reflow', 'Supports', 'The dashboard, settings and sign-in reflow at 320 CSS pixels (fixed in this review: the create tiles, the photo controls and a long email address ran out of their column). The board is a two-dimensional canvas, which the criterion excepts; its chrome has a phone layout.'],
  ['1.4.11 Non-text Contrast', 'Partially Supports', 'Focus rings, selection, handles and field borders meet 3:1; not every control’s states have been measured yet.'],
  ['1.4.12 Text Spacing', 'Supports', 'With WCAG’s spacing override, text on the dashboard, settings and sign-in is not cut off.'],
  ['1.4.13 Content on Hover or Focus', 'Supports', 'Fixed in this review: tooltips stay while the pointer rests on them and close on Escape without moving the pointer or focus.'],
  ['2.4.5 Multiple Ways', 'Supports', 'Boards are found from the dashboard, search, recent and starred lists, projects and links.'],
  ['2.4.6 Headings and Labels', 'Supports', 'Headings and labels describe their topic or purpose.'],
  ['2.4.7 Focus Visible', 'Supports', 'A 2 px focus ring everywhere, an inset ring on the canvas, system colours in forced-colours mode.'],
  ['2.4.11 Focus Not Obscured (Minimum)', 'Supports', 'The item focused on the board is brought into the area no toolbar or panel covers; dialogs and popovers take focus inside them.'],
  ['2.5.7 Dragging Movements', 'Partially Supports', 'Items move and resize with the keyboard and through menus, and slides reorder from their menu (added in this review). Freehand drawing and freeform connector paths need dragging.'],
  ['2.5.8 Target Size (Minimum)', 'Supports', 'Controls are at least 32 px (40 px on touch screens). Fixed in this review: a long board menu squeezed its items below 24 px. Items on a board are the size their author made them.'],
  ['3.1.2 Language of Parts', 'Partially Supports', 'Board content is shown in the language it was written in and isn’t marked with its language.'],
  ['3.2.3 Consistent Navigation', 'Supports', 'Navigation keeps its place and order across the dashboard and settings; every board has the same chrome.'],
  ['3.2.4 Consistent Identification', 'Supports', 'The same function has the same name and icon everywhere.'],
  ['3.3.3 Error Suggestion', 'Supports', 'Errors say how to fix them (for example the allowed range of a value).'],
  ['3.3.4 Error Prevention (Legal, Financial, Data)', 'Supports', 'Deleting a board, a workspace or an account asks for confirmation; boards go to the trash first, and board versions can be restored.'],
  ['3.3.8 Accessible Authentication (Minimum)', 'Supports', 'No memory or puzzle test: password managers and paste work, two-step codes accept autofill, and sign-in with Google, Microsoft or single sign-on is offered. No CAPTCHA.'],
  ['4.1.3 Status Messages', 'Supports', 'Toasts, selection changes and collaborators’ edits are announced through live regions without taking focus.'],
];

function Criteria({ caption, rows }: { caption: string; rows: Row[] }) {
  return <Table caption={caption} stack head={['Criteria', 'Conformance Level', 'Remarks and Explanations']} rows={rows.map(([c, l, r]) => [c, l, r])} />;
}

export default definePage({
  path: '/accessibility',
  name: 'Accessibility',
  title: 'Accessibility conformance report (WCAG 2.2) · Freero',
  ogTitle: 'Accessibility conformance report',
  description: 'How Freero meets WCAG 2.2 level A and AA, criterion by criterion, in the VPAT 2.5 format: a self-assessment pending an independent audit.',
  updated: UPDATED,
  underReview: true,
  closingCta: false,
  body: () => (
    <LegalArticle
      title="Accessibility Conformance Report"
      updated={UPDATED}
      intro={
        <>
          <p>
            <strong>A self-assessment, pending an independent audit.</strong> This report was written by the Freero team from its own review; no
            accessibility auditor has evaluated Freero yet. It follows the structure of the VPAT® 2.5 (WCAG edition) published by the Information
            Technology Industry Council, and says “Partially Supports” wherever we know of a gap.
          </p>
          <p>
            Freero is run by {L('operator')} at <a href={abs('/')}>{abs('/')}</a>; the same software is <a href={SOURCE_REPO}>open source</a>. What
            we check, how, and what remains is kept in <a href={docsUrl('docs/accessibility.md')}>docs/accessibility.md</a>.
          </p>
        </>
      }
      toc={[
        ['product', 'Product information'],
        ['methods', 'Evaluation methods used'],
        ['standards', 'Applicable standards and guidelines'],
        ['terms', 'Terms'],
        ['level-a', 'WCAG 2.2 report: Level A'],
        ['level-aa', 'WCAG 2.2 report: Level AA'],
        ['level-aaa', 'WCAG 2.2 report: Level AAA'],
        ['gaps', 'Known gaps and plans'],
        ['legal', 'Legal disclaimer'],
      ]}
    >
      <h2 id="product">1. Product information</h2>
      <Table
        caption="Product information"
        stack
        head={['Item', 'Detail']}
        rows={[
          ['Name of product / version', 'Freero web app (the hosted service and the open-source software), as of the report date'],
          ['Report date', UPDATED],
          [
            'Product description',
            'A collaborative online whiteboard: an infinite canvas with sticky notes, shapes, text, connectors, frames, images, cards and kanbans, comments, voting, a timer, presenting and recorded walkthroughs, with a dashboard, account settings and an admin console for workspaces.',
          ],
          ['Contact information', <a href="/support">Help and support</a>],
          [
            'Notes',
            'Covers the web app’s chrome and the board as far as a free-form canvas allows. Content people put on boards (their pictures, colours, files and recordings) is theirs and is not covered. The marketing site is not covered by this report.',
          ],
        ]}
      />

      <h2 id="methods">2. Evaluation methods used</h2>
      <ul>
        <li>
          Automated testing with axe-core 4.14 against the running app in Chromium, with the WCAG 2.0, 2.1 and 2.2 A and AA rules, in 17 states: sign-in,
          sign-up, the dashboard, account settings, the admin console, a board idle and with a selection, the share dialog, the board menu, the timer, the
          shortcut sheet, the walkthrough dialog, presenting, the dark theme and phone width. The check runs from the source code (<code>npm run a11y</code>).
          Last result: no violations.
        </li>
        <li>
          Keyboard-only passes through the dashboard, a board, the share dialog, account settings and presenting; the accessibility tree the browser exposes
          (names, roles, states) read for the same flows.
        </li>
        <li>Reflow at 320 CSS pixels, WCAG’s text-spacing override, forced colours and reduced motion, and tablet and phone emulation.</li>
        <li>
          <strong>Not yet used:</strong> real screen readers (NVDA, JAWS, VoiceOver, TalkBack), speech input, or testing by people with disabilities. They
          are part of the independent audit this report is waiting for.
        </li>
      </ul>

      <h2 id="standards">3. Applicable standards and guidelines</h2>
      <Table
        caption="Standards and guidelines"
        stack
        head={['Standard / guideline', 'Included in report']}
        rows={[
          ['Web Content Accessibility Guidelines 2.0', 'Level A (yes), Level AA (yes), Level AAA (no)'],
          ['Web Content Accessibility Guidelines 2.1', 'Level A (yes), Level AA (yes), Level AAA (no)'],
          ['Web Content Accessibility Guidelines 2.2', 'Level A (yes), Level AA (yes), Level AAA (no)'],
        ]}
      />

      <h2 id="terms">4. Terms</h2>
      <ul>
        <li>
          <strong>Supports:</strong> the functionality has at least one method that meets the criterion without known defects, or meets it with equivalent
          facilitation.
        </li>
        <li>
          <strong>Partially Supports:</strong> some functionality does not meet the criterion.
        </li>
        <li>
          <strong>Does Not Support:</strong> the majority of the functionality does not meet the criterion.
        </li>
        <li>
          <strong>Not Applicable:</strong> the criterion is not relevant to the product.
        </li>
        <li>
          <strong>Not Evaluated:</strong> the product has not been evaluated against the criterion (used only for Level AAA).
        </li>
      </ul>

      <h2 id="level-a">5. WCAG 2.2 report: Level A</h2>
      <Criteria caption="Table 1: Success Criteria, Level A" rows={LEVEL_A} />

      <h2 id="level-aa">6. WCAG 2.2 report: Level AA</h2>
      <Criteria caption="Table 2: Success Criteria, Level AA" rows={LEVEL_AA} />

      <h2 id="level-aaa">7. WCAG 2.2 report: Level AAA</h2>
      <p>Not Evaluated.</p>

      <h2 id="gaps">8. Known gaps and plans</h2>
      <ul>
        <li>Items on a board are not individual focus targets for screen readers in browse mode; Board as list (Alt+Shift+L) is the way to read a board.</li>
        <li>Freehand drawing and freeform connector paths need a pointer.</li>
        <li>Board content isn’t marked with the language it was written in.</li>
        <li>An independent audit, including real screen readers and speech input, is planned before this report stops being a self-assessment.</li>
      </ul>

      <h2 id="legal">9. Legal disclaimer</h2>
      <p>
        This report describes the product as of the report date, as its makers assessed it. It is provided for information, is not a warranty, and may
        change as the product does. To report a barrier or ask for help, contact <a href="/support">support</a>.
      </p>
    </LegalArticle>
  ),
});

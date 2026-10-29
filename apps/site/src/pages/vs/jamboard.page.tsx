// Freero as a Jamboard alternative (#72). Facts: docs/marketing/competitors/jamboard.md (the sheet
// cites URLs, given ids J<n> here). Jamboard is discontinued: the column is "Jamboard (until 2024)"
// and the copy is in the past tense. What happened to jams is worded exactly as the sheet records it
// (Google's help page now says they were converted to PDFs in 2025; the 2023 notice said deletion).
// Left out as "Could not verify": the date and completeness of that conversion, whether Miro's and
// Lucidspark's Jamboard importers still exist, the education $600 fee, guest access and an
// accessibility statement (no rows for them). Freero has no Jamboard importer; PDF upload exists.
import { defineComparison } from '../../lib/compare';

export default defineComparison({
  slug: 'jamboard',
  competitor: 'Jamboard',
  column: 'Jamboard (until 2024)',
  checked: '2026-10-28',
  published: true,
  title: 'Jamboard alternative and replacement: Freero vs Jamboard',
  description:
    'Google shut Jamboard down on 31 December 2024. Where your jams went, and how Freero compares as a free replacement for classrooms and teams.',
  summary:
    'Jamboard was Google’s simple whiteboard: a free app for Google accounts and a 55-inch touch display, both shut down in 2024. Freero is a free, open-source whiteboard for classrooms, teams and AI agents that runs in the browser and that you can host yourself.',
  competitorStrongerTitle: 'What Jamboard did that Freero doesn’t',
  trademark: 'Google and Jamboard are trademarks of Google LLC.',
  rows: [
    {
      capability: 'Available today',
      competitor: { verdict: 'no', note: 'the app shut down on 2024-12-31', sources: ['J1'] },
      freero: { verdict: 'yes', note: 'in any current browser, installable as a web app', ref: 'docs/parity.md' },
    },
    {
      capability: 'Free to use',
      competitor: { verdict: 'yes', note: 'the app had no separate charge; the 55-inch board cost $4,999 plus $600 a year', sources: ['J7', 'J6'] },
      freero: { verdict: 'yes', note: 'no paid plans and no hardware to buy; self-hosting costs your own servers', ref: 'docs/parity.md' },
    },
    {
      capability: 'Dedicated hardware',
      competitor: { verdict: 'yes', note: 'a 55-inch 4K touch display with camera, microphones and stylus', sources: ['J7'] },
      freero: { verdict: 'no', note: 'software only; touch and pen work on tablets', ref: 'docs/parity.md' },
    },
    {
      capability: 'Infinite canvas',
      competitor: { verdict: 'no', note: 'a jam was a short deck of frames', sources: ['J7'] },
      freero: { verdict: 'yes', note: 'with frames you can present or export as PDF pages', ref: 'README.md' },
    },
    {
      capability: 'Pens, sticky notes, images and shapes',
      competitor: { verdict: 'yes', note: 'plus a laser pointer', sources: ['J7'] },
      freero: { verdict: 'yes', note: 'plus connectors, mind maps, tables, cards and a laser pointer', ref: 'docs/parity.md' },
    },
    {
      capability: 'Voting, timer and polls',
      competitor: { verdict: 'no', note: 'pens, notes, images and frames', sources: ['J7'] },
      freero: { verdict: 'yes', note: 'plus word clouds, Q&A and private mode; students answer through a link', ref: 'docs/parity.md' },
    },
    {
      capability: 'Google Drive and Meet',
      competitor: { verdict: 'yes', note: 'jams saved to Drive, opened from Meet', sources: ['J7'] },
      freero: { verdict: 'no', note: 'Google sign-in, but no Drive or Classroom integration', ref: 'docs/parity.md' },
    },
    {
      capability: 'Mobile apps',
      competitor: { verdict: 'yes', note: 'iOS and Android, until the shutdown', sources: ['J7', 'J1'] },
      freero: { verdict: 'no', note: 'installable web app; phones view and comment', ref: 'docs/parity.md' },
    },
    {
      capability: 'Open source, on your own servers',
      competitor: { verdict: 'no', note: 'a Google cloud service', sources: ['J4'] },
      freero: { verdict: 'yes', note: 'MIT licence; Docker, on a school’s or company’s own servers', ref: 'docs/deployment.md' },
    },
  ],
  competitorStronger: [
    'You need your old jams as editable sticky notes: FigJam lists Jamboard as an import source, while Freero can only place a jam’s PDF on a board.',
    'You want a purpose-built board for the classroom wall, with a camera, microphones and a stylus.',
    'You want everything inside Google Workspace: boards saved in Drive and opened from Meet.',
    'You teach young students who need the smallest possible toolset: Freero does much more, which can be more to learn.',
    'You want native phone apps for editing.',
  ],
  freeroStronger: [
    'You want a whiteboard that is free, still developed, and open source, so no vendor can switch it off.',
    'You run lessons or workshops with voting, a shared timer, polls, word clouds and Q&A.',
    'You want an infinite canvas, frames you can present, and templates to start from.',
    'You want visitors to join a shared board with just a name, without an account.',
    'You need more than a board: AI agents through MCP, Jira, Linear and GitHub sync, SSO and SCIM.',
  ],
  sections: [
    {
      id: 'what-happened',
      title: 'What happened to Jamboard',
      lead: 'Google wound Jamboard down over 2023 and 2024. The dates, and what is left of your jams:',
      placement: 'intro',
      body: (cite) => (
        <>
          <dl className="dates">
            <dt>
              <time dateTime="2023-09-28">28 September 2023</time>
            </dt>
            <dd>Google announced the end of Jamboard and pointed whiteboard users to FigJam, Lucidspark and Miro. {cite('J1', 'J2')}</dd>
            <dt>
              <time dateTime="2024-09-30">30 September 2024</time>
            </dt>
            <dd>Licences for the Jamboard display ended, and with them management and software updates. {cite('J4', 'J1')}</dd>
            <dt>
              <time dateTime="2024-10-01">1 October 2024</time>
            </dt>
            <dd>The app became view-only: no new or edited jams on any platform. {cite('J1', 'J4')}</dd>
            <dt>
              <time dateTime="2024-12-31">31 December 2024</time>
            </dt>
            <dd>The app shut down on the web, iOS, Android and Meet devices. This was also the deadline Google gave for exporting jams. {cite('J1')}</dd>
            <dt>2025</dt>
            <dd>
              Google’s help page now says jams were converted to PDFs in 2025 and are in Google Drive. Its original 2023 notice said jams would be permanently
              deleted after 31 December 2024. {cite('J3', 'J1')}
            </dd>
          </dl>
          <p>
            <strong>Looking for your jams?</strong> Google’s help page says to search Google Drive for <code>type:Jam</code> and download them as PDF, or as
            PNG for a single frame. {cite('J3')} A Jamboard display can still be used offline as a basic whiteboard or as an HDMI screen, but it can’t save
            to Drive or join Meet. {cite('J4')}
          </p>
        </>
      ),
    },
    {
      id: 'bringing-jams',
      title: 'Bringing jams into Freero',
      body: (cite) => (
        <>
          <p>
            Freero has no Jamboard importer. What it can do is take the PDF of a jam: upload it to a board and it becomes a document you can page through, or
            place all its pages as images in a grid, one per frame. Then draw, add sticky notes and comment on top. The old content stays a picture; it doesn’t
            become editable notes again.
          </p>
          <p>
            If you need editable notes back, FigJam lists Jamboard as an import source. {cite('J9')}
          </p>
          <p>
            For a school or team, Freero is <a href="/pricing">free with no paid plans</a>, and it can run on your own servers: see{' '}
            <a href="/open-source">self-hosting Freero</a> and <a href="/security">security</a>. To bring AI into lessons or planning, see{' '}
            <a href="/agents">how agents work on Freero boards</a>, or connect <a href="/claude">Claude</a> or <a href="/chatgpt">ChatGPT</a>.
          </p>
        </>
      ),
    },
  ],
  faq: [
    {
      q: 'Is Jamboard still available?',
      a: 'No. Google made the Jamboard app view-only on 1 October 2024 and shut it down on 31 December 2024, on the web, iOS, Android and Meet devices. Licences for the Jamboard display ended on 30 September 2024.',
    },
    {
      q: 'Where are my Jamboard files now?',
      a: 'Google’s help page says jams were converted to PDFs in 2025 and are in Google Drive: search Drive for type:Jam and download them as PDF, or as PNG for a single frame. Google’s original 2023 notice said jams would be deleted after 31 December 2024, so check Drive rather than assume either way.',
    },
    {
      q: 'Can I import my jams into Freero?',
      a: 'Not as editable content: Freero has no Jamboard importer. You can upload a jam’s PDF to a Freero board and place its pages as images, then work on top of them.',
    },
    {
      q: 'Is Freero a free Jamboard alternative for teachers?',
      a: 'Freero is free, with no paid plans, and works in any current browser. Students can join a shared board with just a name, and lessons can use voting, a timer, polls, word clouds and Q&A. It has no Google Classroom or Drive integration, and on phones it is view-and-comment.',
    },
  ],
  sources: [
    { id: 'J1', title: 'Google Workspace Updates: The next phase of digital whiteboarding (2023-09-28)', url: 'https://workspaceupdates.googleblog.com/2023/09/the-next-phase-of-digital-whiteboarding-for-google-workspace.html', checked: '2026-10-28' },
    { id: 'J2', title: 'Google Workspace blog: The next phase of digital whiteboarding', url: 'https://workspace.google.com/blog/product-announcements/next-phase-digital-whiteboarding', checked: '2026-10-28' },
    { id: 'J3', title: 'Jamboard Help Center: jams as PDFs in Google Drive', url: 'https://support.google.com/jamboard/answer/14084927', checked: '2026-10-28' },
    { id: 'J4', title: 'Jamboard Help Center: end of life for Jamboard devices', url: 'https://support.google.com/jamboard/answer/14011742', checked: '2026-10-28' },
    { id: 'J6', title: 'VentureBeat: Google starts selling Jamboard for $4,999 (2017)', url: 'https://venturebeat.com/business/google-starts-selling-4k-digital-whiteboard-jamboard-for-4999-in-the-u-s', checked: '2026-10-28' },
    { id: 'J7', title: 'Wikipedia: Jamboard', url: 'https://en.wikipedia.org/wiki/Jamboard', checked: '2026-10-28' },
    { id: 'J9', title: 'Figma Help Center: importing into FigJam (lists Jamboard)', url: 'https://help.figma.com/hc/en-us/articles/1500007927941', checked: '2026-10-28' },
  ],
});

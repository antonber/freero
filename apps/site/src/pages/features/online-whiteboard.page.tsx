// /features/online-whiteboard — the "free online whiteboard" / "collaborative whiteboard" search: what
// a team gets for free, checked against the code and the pricing page's default limits. Guests on a
// link can view or comment (members/roles.ts resolveGuestRole), never edit: said so. Other products'
// free plans are quoted only from docs/marketing/competitors/ (checked 2026-10-28) and link to the
// sourced comparison pages.
import { ButtonLink, Card, Cards, Checks, Hero, Section, Shot } from '../../components/ui';
import { definePage } from '../../lib/define';
import { feature, FeatureTemplates, OtherFeatures } from '../../lib/features';
import { softwareApplication } from '../../lib/seo';
import { APP } from '../../lib/site';
import { SITE_TEMPLATES } from '../../lib/templates';

const f = feature('online-whiteboard');

export default definePage({
  path: '/features/online-whiteboard',
  name: f.name,
  title: 'Free online whiteboard for teams, with no paid plan | Freero',
  ogTitle: 'A free online whiteboard, with nothing held back',
  description:
    'A free collaborative online whiteboard: unlimited editors, 5,000 boards per account, live cursors, templates, voting and timers. Open source, no paid tier.',
  updated: '2026-11-02',
  sitemap: 'features',
  jsonLd: [softwareApplication()],
  faq: [
    {
      q: 'Is this online whiteboard really free?',
      a: 'Yes. Freero has no paid plan and no feature behind a paywall. Each account can own up to 5,000 boards and 1 GB of uploads by default, with as many editors, commenters and viewers as you like. Freero is open source under the MIT licence, so you can also run it on your own servers.',
    },
    {
      q: 'Do I need an account?',
      a: 'To create and edit boards, yes: sign-up is free with an email address. People you share a link with can join as guests without an account to view the board or, if the link allows it, to comment.',
    },
    {
      q: 'How many people can work on a board at once?',
      a: 'There is no seat count. Everyone you invite edits live, with their cursor and selection visible to the others, and you can follow someone’s view or bring everyone to yours.',
    },
    {
      q: 'Does it work on a tablet or phone?',
      a: 'Yes. Freero runs in current versions of Chrome, Edge, Firefox and Safari, on desktop, tablets and phones, and can be installed as an app from the browser.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Feature · Online whiteboard"
        title="A free online whiteboard for your whole team"
        lead="An infinite canvas where everyone works live: sticky notes, shapes and diagrams, kanban boards and mind maps, with the workshop tools built in. No plan to upgrade to, no seat to buy, no cap of three boards."
        actions={
          <>
            <ButtonLink href={APP.signup}>Start a board free</ButtonLink>
            <ButtonLink href="/templates" variant="secondary">
              Browse {SITE_TEMPLATES.length} templates
            </ButtonLink>
          </>
        }
        aside={<Shot name="workshop" eager alt="A Freero board during a retro: a frame of sticky notes with two teammates’ cursors on it." sizes="(min-width: 960px) 520px, 100vw" />}
      />

      <Section id="free" title="What free means here" tone="tint" narrow>
        <Checks
          kind="yes"
          items={[
            'As many editors, commenters and viewers as you like, on as many boards as you need: 5,000 per account by default',
            'Every whiteboard, diagram and workshop feature, with no paid tier waiting behind it',
            'Guests on a shared link can view or comment without an account',
            '1 GB of uploads per account for images, PDFs, video and audio',
            'Export to PNG, JPG, SVG or PDF, and a full board backup you can restore',
          ]}
        />
        <p>
          On 28 October 2026, the free plans of several well-known whiteboards allowed three editable boards or files (see{' '}
          <a href="/vs/miro">Freero vs Miro</a>, <a href="/vs/mural">vs Mural</a> and <a href="/vs/figjam">vs FigJam</a>, with sources). Freero’s limits are on the{' '}
          <a href="/pricing">pricing page</a>, and whoever runs a Freero server can change them.
        </p>
      </Section>

      <Section id="canvas" title="Everything on one canvas">
        <Cards cols={3}>
          <Card title="Sticky notes and text" href="/use-cases/brainstorming">
            Twelve sticky colours, Tab for the next note, tags, clusters by colour or tag, and reactions.
          </Card>
          <Card title="Flowcharts and diagrams" href="/features/flowchart-maker">
            Shape sets for flowcharts, UML, BPMN, ERD and networks, attached connectors, auto-layout and Mermaid.
          </Card>
          <Card title="Mind maps" href="/features/mind-map">
            Keyboard-first maps that lay themselves out; paste an indented list to start one.
          </Card>
          <Card title="Kanban and cards" href="/features/kanban-board">
            Columns that set status, WIP limits, due dates and assignees, synced with Jira, Linear or GitHub.
          </Card>
          <Card title="Frames, docs and media">
            Frames that become slides, collaborative docs, images, PDFs, video, embeds and link previews.
          </Card>
          <Card title="Timelines and tables">
            Roadmaps on a timeline, Gantt bars, and tables with typed columns and a board view.
          </Card>
        </Cards>
      </Section>

      <Section id="together" tone="tint" title="Made for working together, live">
        <div className="columns-2">
          <ul className="checks checks--yes">
            <li>
              <strong>Live cursors and selections</strong> for everyone on the board, and follow mode to see what someone else sees.
            </li>
            <li>
              <strong>Comments with mentions</strong>, notifications, and an activity feed of who changed what.
            </li>
            <li>
              <strong>Version history</strong> that brings back any earlier state of the board.
            </li>
          </ul>
          <ul className="checks checks--yes">
            <li>
              <strong>Facilitation:</strong> a shared timer, dot voting, private writing, polls and <a href="/use-cases/planning-poker">planning poker</a>.
            </li>
            <li>
              <strong>Present from the board:</strong> frames as slides, a laser pointer and presenter notes.
            </li>
            <li>
              <strong>Roles and sharing:</strong> owner, editor, commenter and viewer, and links with a password or an expiry date.
            </li>
          </ul>
        </div>
        <p>
          See it in practice: <a href="/use-cases/retrospectives">retrospectives</a>, <a href="/use-cases/workshops">workshops</a> and{' '}
          <a href="/use-cases/user-story-mapping">user story mapping</a>.
        </p>
      </Section>

      <Section id="agents" title="Your AI assistant can join the board" lead="Freero is built for teams of people and AI agents.">
        <p>
          Connect <a href="/claude">Claude</a> or <a href="/chatgpt">ChatGPT</a> over MCP and the assistant reads the board, groups notes, drafts diagrams and
          proposes changes that people accept or reject. Everything it adds carries its name and yours. Building your own agent? Start at{' '}
          <a href="/agents">Freero for builders</a>.
        </p>
      </Section>

      <Section id="own" tone="tint" title="Free, and yours to keep" narrow>
        <p>
          Freero is open source under the MIT licence. Use the hosted service, or <a href="/open-source">run it on your own servers</a> with one Docker image,
          including single sign-on, SCIM and an audit log. Your boards export as files you can restore anywhere Freero runs.
        </p>
      </Section>

      <Section id="templates" title="Start from a template">
        <FeatureTemplates slug={f.slug} />
        <p>
          <a href="/templates">All {SITE_TEMPLATES.length} templates by category</a>
        </p>
      </Section>

      <Section id="more" tone="tint" title="More of the whiteboard" narrow>
        <OtherFeatures slug={f.slug} />
      </Section>
    </>
  ),
});

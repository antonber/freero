// /features/mind-map — "free mind map maker": the mind map element (features/mindmap), outline paste
// and Insert from text (features/from-text), Mermaid mind maps (shared/layout/mermaid.ts), checked
// against the code. Not claimed: Mermaid export, mind map file imports (FreeMind, XMind).
import { ButtonLink, Hero, Prompts, Section, Shot, Table } from '../../components/ui';
import { definePage } from '../../lib/define';
import { feature, FeatureTemplates, OtherFeatures } from '../../lib/features';
import { softwareApplication } from '../../lib/seo';
import { APP } from '../../lib/site';
import { useTemplateHref } from '../../lib/templates';

const f = feature('mind-map');

export default definePage({
  path: '/features/mind-map',
  name: f.name,
  title: 'Free mind map maker: online, collaborative | Freero',
  ogTitle: 'Mind maps that lay themselves out',
  description:
    'Make mind maps online for free, together and live: Tab and Enter add ideas, branches lay themselves out, and an indented list pastes in as a mind map.',
  updated: '2026-11-02',
  sitemap: 'features',
  jsonLd: [softwareApplication()],
  faq: [
    {
      q: 'Is the mind map maker free?',
      a: 'Yes. Freero is free with no paid plan, and mind maps have no limit of their own beyond the default 5,000 boards per account. Freero is also open source, under the MIT licence.',
    },
    {
      q: 'Can several people edit a mind map at the same time?',
      a: 'Yes. A mind map is part of a Freero board, so everyone on the board edits it live and sees each other’s cursors. People you invite edit with a free account; guests on a shared link can view or comment.',
    },
    {
      q: 'Can I turn a list or notes into a mind map?',
      a: 'Yes. Paste an indented list (bullets, numbers, tabs or spaces, at least two levels deep) onto the board and it becomes a mind map, up to 500 ideas. Insert from text does the same with a preview, and also reads a Mermaid mindmap.',
    },
    {
      q: 'Can I export a mind map?',
      a: 'Copy as outline puts the mind map on the clipboard as an indented Markdown list. The board, a selection or the visible area exports as PNG, JPG or SVG, and frames as a PDF.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Feature · Mind map"
        title="A free mind map maker your whole team can edit"
        lead="Start with one idea and branch out at the speed you type. Freero lays the map out for you, keeps every branch tidy as it grows, and puts the map on the same board as your notes, diagrams and plans."
        actions={
          <>
            <ButtonLink href={useTemplateHref('mindmap')}>Start a mind map</ButtonLink>
            <ButtonLink href="#keys" variant="secondary">
              Keyboard shortcuts
            </ButtonLink>
          </>
        }
        aside={<Shot name="mindmap" eager alt="A Freero mind map: a central topic, Team offsite, with coloured branches for sessions, venue, travel and the evening." sizes="(min-width: 960px) 520px, 100vw" />}
      />

      <Section id="keys" title="Built for the keyboard" lead="Press M and click (or Enter) to place a central topic and start typing. From there you rarely need the mouse." tone="tint" narrow>
        <Table
          caption="Mind map keyboard shortcuts"
          head={['Key', 'What it does']}
          rows={[
            ['Tab', 'Add a child idea'],
            ['Enter', 'Add a sibling idea'],
            ['Shift+Tab', 'Move an idea up a level'],
            ['Arrow keys', 'Move between ideas'],
            ['Alt+↑ / Alt+↓', 'Reorder an idea among its siblings'],
            ['Space', 'Collapse or expand a branch'],
            ['Delete', 'Delete an idea and its branch'],
          ]}
        />
      </Section>

      <Section id="layout" title="It lays itself out" lead="No dragging boxes into place: the map grows to the left, the right or both sides, and Tidy up straightens it after you have moved things.">
        <div className="columns-2">
          <ul className="checks checks--yes">
            <li>
              <strong>Branches move as one.</strong> Drag an idea and its whole branch comes with it.
            </li>
            <li>
              <strong>Collapse what you are not discussing.</strong> Fold a branch away and open it again later.
            </li>
            <li>
              <strong>From an outline.</strong> Paste meeting notes or a document’s headings as an indented list and get a mind map of up to 500 ideas.
            </li>
          </ul>
          <ul className="checks checks--yes">
            <li>
              <strong>From Mermaid.</strong> Paste a Mermaid <code>mindmap</code> and it becomes an editable map; Edit diagram source changes it later.
            </li>
            <li>
              <strong>Out again.</strong> Copy as outline gives you a Markdown list; export the board as PNG, JPG, SVG or PDF.
            </li>
            <li>
              <strong>Next to everything else.</strong> Turn ideas into <a href="/features/kanban-board">kanban cards</a> or a <a href="/features/flowchart-maker">flowchart</a> on the same board.
            </li>
          </ul>
        </div>
      </Section>

      <Section id="agents" tone="tint" title="Mind maps from a conversation" lead="Connected over MCP, Claude or ChatGPT can lay out a mind map on your board from what you discussed, or read one back as an outline.">
        <Prompts
          items={[
            { prompt: 'Make a mind map of the options we just talked about on my planning board.', outcome: 'It sends the ideas as an outline and Freero lays out the map; with the default permissions it arrives as a suggestion to accept.' },
            { prompt: 'Read the mind map on this board and write it up as a plan.', outcome: 'It reads the board’s outline, branch by branch, and answers in the chat.' },
          ]}
        />
        <p>
          Set it up for <a href="/claude">Claude</a> or <a href="/chatgpt">ChatGPT</a>. For running a whole session, see <a href="/use-cases/brainstorming">brainstorming on Freero</a>.
        </p>
      </Section>

      <Section id="templates" title="Mind map templates">
        <FeatureTemplates slug={f.slug} />
        <p>
          <a href="/templates/category/brainstorming">All brainstorming templates</a>
        </p>
      </Section>

      <Section id="more" tone="tint" title="More of the whiteboard" narrow>
        <OtherFeatures slug={f.slug} />
        <p>
          <ButtonLink href={APP.signup}>Start free</ButtonLink>
        </p>
      </Section>
    </>
  ),
});

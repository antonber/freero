// /features/flowchart-maker — "free online flowchart / diagram maker": shapes and the shape library
// (features/shape), connectors (features/connector), Mermaid and Insert from text (features/from-text,
// shared/layout/mermaid.ts, plantuml.ts), auto-layout (features/arrange), draw.io, Excalidraw and
// Visio (.vsdx) import (features/import), checked against the code. Not claimed: Mermaid Gantt
// or other diagram types beyond flowchart, sequence, class, ER, state and mind map.
import { ButtonLink, Card, Cards, Code, Hero, Prompts, Section, Shot } from '../../components/ui';
import { definePage } from '../../lib/define';
import { feature, FeatureTemplates, OtherFeatures } from '../../lib/features';
import { softwareApplication } from '../../lib/seo';
import { APP } from '../../lib/site';
import { useTemplateHref } from '../../lib/templates';

const f = feature('flowchart-maker');

export default definePage({
  path: '/features/flowchart-maker',
  name: f.name,
  title: 'Free online flowchart and diagram maker, with Mermaid',
  ogTitle: 'Flowcharts and diagrams, together',
  description:
    'Draw flowcharts, UML, BPMN, ERD and network diagrams online, free and together: connectors that stay attached, auto-layout and Mermaid import.',
  updated: '2026-11-06',
  sitemap: 'features',
  jsonLd: [softwareApplication()],
  faq: [
    {
      q: 'Is the flowchart maker free?',
      a: 'Yes. Every shape set, connector style, Mermaid import and export format is part of Freero, which has no paid plan. It is open source under the MIT licence.',
    },
    {
      q: 'Can I paste a Mermaid diagram?',
      a: 'Yes. Paste Mermaid text onto the board, or use Insert from text, and a flowchart (with subgraphs as frames), a sequence, class, ER or state diagram or a mind map becomes editable shapes and connectors; PlantUML works the same way. The source is kept, so Edit diagram source changes the diagram and lays it out again. Other Mermaid diagram types, such as Gantt charts, are refused with the line that caused it.',
    },
    {
      q: 'Can I import draw.io, Visio or Excalidraw files?',
      a: 'Yes. Import a draw.io (.drawio), Visio (.vsdx, also Lucidchart’s Visio export) or Excalidraw file and its shapes, text and connectors become editable Freero items in one undo step, with a report of anything that could not be mapped. Visio pages become frames, and its containers and swimlanes frames too.',
    },
    {
      q: 'How do I export a diagram?',
      a: 'Export the whole board, a selection or the visible area as PNG, JPG or SVG at 1x, 2x or 3x, with or without the background, or export frames as a PDF.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Feature · Flowcharts and diagrams"
        title="A free online flowchart and diagram maker for teams"
        lead="Draw a process with the people who run it. Freero has shape sets for flowcharts, UML, BPMN, ERD, networks and wireframes, connectors that stay attached when you move things, automatic layout, and Mermaid that turns into a diagram you can keep editing."
        actions={
          <>
            <ButtonLink href={useTemplateHref('flowchart')}>Start a flowchart</ButtonLink>
            <ButtonLink href="#mermaid" variant="secondary">
              Diagrams from Mermaid
            </ButtonLink>
          </>
        }
        aside={<Shot name="flowchart" eager alt="A support triage flowchart on a Freero board: decisions as diamonds, steps as boxes, labelled Yes and No connectors." sizes="(min-width: 960px) 520px, 100vw" />}
      />

      <Section id="shapes" title="Shapes for every kind of diagram" lead="Choose which shape sets a board shows, then search the shape library or use the shortcuts: S for shapes, R for a rectangle, O for a circle, L for a connector." tone="tint">
        <Cards cols={4}>
          <Card title="Flowchart">Process, decision, terminator, data, document, delay, manual input, off-page reference and the rest of the standard set.</Card>
          <Card title="UML and sequence">Class, actor, package, component, node and note, plus lifelines, activations and fragments for sequence diagrams.</Card>
          <Card title="BPMN and ERD">Events, gateways, subprocesses and message, timer and error events; entities with crow’s-foot line ends.</Card>
          <Card title="Network and wireframe">Servers, firewalls, routers and devices; browser, phone and form controls for quick wireframes.</Card>
        </Cards>
      </Section>

      <Section id="connectors" title="Connectors that stay connected">
        <div className="columns-2">
          <ul className="checks checks--yes">
            <li>
              <strong>Attached ends.</strong> Connect to any point on a shape’s outline; move the shape and the line follows.
            </li>
            <li>
              <strong>Straight, elbow or curved</strong>, solid, dashed or dotted, with arrowheads, circles, diamonds, bars and crow’s feet.
            </li>
            <li>
              <strong>Labels on lines.</strong> Double-click a line to label it, as many times as the line needs.
            </li>
          </ul>
          <ul className="checks checks--yes">
            <li>
              <strong>Auto-layout.</strong> Select connected shapes and lay them out top-down, left to right, as a tree or as an org chart.
            </li>
            <li>
              <strong>Swimlanes and tables.</strong> Lanes and phases that grow with their content, and tables with typed columns.
            </li>
            <li>
              <strong>Bring your diagrams.</strong> Import draw.io, Visio (.vsdx) and Excalidraw files as editable shapes.
            </li>
          </ul>
        </div>
      </Section>

      <Section id="mermaid" tone="tint" title="Diagrams from text" lead="Write it, paste it, and keep editing it as a diagram. Mermaid flowcharts, sequence diagrams and mind maps are laid out on the board as real shapes and connectors.">
        <div className="columns-2">
          <Code label="Paste this onto a board">{`flowchart TD
  A([New ticket]) --> B{Is it a bug?}
  B -- Yes --> C[Reproduce it]
  B -- No --> D[Answer from the help centre]
  C --> E{Reproduced?}
  E -- Yes --> F[File an issue with the steps]
  E -- No --> G[Ask the customer for details]`}</Code>
          <div>
            <p>
              Insert from text also takes an org chart as “Name, Title, Manager” lines, a tree or mind map as an indented list, a kanban and a table, each with a
              preview before it lands as one undo step.
            </p>
            <p>
              Subgraphs become frames, node shapes and edge styles carry over, and Edit diagram source changes the diagram later. Diagrams of up to 2,000
              elements.
            </p>
          </div>
        </div>
      </Section>

      <Section id="agents" title="Ask an agent to draw it" lead="Connected over MCP, an assistant describes the diagram and Freero lays it out, so it never has to guess coordinates.">
        <Prompts
          items={[
            { prompt: 'Draw our deploy pipeline as a flowchart on the architecture board.', outcome: 'It sends the steps and decisions as a graph or Mermaid; Freero lays it out and, by default, shows it as a suggestion to accept.' },
            { prompt: 'Explain the flow on this board and point out steps with no exit.', outcome: 'It reads the board’s shapes and connectors as an outline and answers in the chat.' },
          ]}
        />
        <p>
          Set it up for <a href="/claude">Claude</a>, <a href="/chatgpt">ChatGPT</a> or <a href="/agents">any MCP client</a>.
        </p>
      </Section>

      <Section id="templates" tone="tint" title="Diagram templates">
        <FeatureTemplates slug={f.slug} />
        <p>
          <a href="/templates/category/diagrams">All diagram templates</a>
        </p>
      </Section>

      <Section id="more" title="More of the whiteboard" narrow>
        <OtherFeatures slug={f.slug} />
        <p>
          <ButtonLink href={APP.signup}>Start free</ButtonLink>
        </p>
      </Section>
    </>
  ),
});

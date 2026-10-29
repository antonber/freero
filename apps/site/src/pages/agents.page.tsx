import { ButtonLink, Card, Cards, Checks, Code, Hero, Section, Step, Steps, Table } from '../components/ui';
import { definePage } from '../lib/define';
import { abs, docsUrl, MCP_URL } from '../lib/site';

const TOOLS: Array<[string, string, string]> = [
  ['list_workspaces', 'read', 'Your workspaces (personal and teams) and your role in each.'],
  ['search_boards', 'read', 'Boards you can open, newest change first, filtered by title or workspace.'],
  ['search', 'read', 'Words in what your boards say: notes, text, shapes, cards, frames, tables, tags, connector labels, comments. Each hit with board, item, snippet and link.'],
  ['get_board_outline', 'read', 'The board as a semantic outline (Markdown or JSON) with item ids, a token budget, a scope and paging.'],
  ['export_board', 'read', 'The whole board as a Markdown or JSON file; follows the workspace’s download policy.'],
  ['resolve_links', 'read', 'What Freero board and item links point at, and whether you can open them.'],
  ['find_backlinks', 'read', 'Items and comments that link to a board or an item.'],
  ['list_templates', 'read', 'Saved templates you can start a board from.'],
  ['open_board', 'read', 'The live board in the conversation, in hosts that show MCP Apps views; elsewhere its link. The view never has more power than the connection.'],
  ['search_docs', 'read', 'Docs (collaborative documents next to boards) you can open, by title.'],
  ['read_doc', 'read', 'A doc as Markdown, with embedded boards as their addresses.'],
  ['get_feedback', 'read', 'What people changed in the agent’s control-room lane since its last look: cards moved, added or removed, new comments.'],
  ['propose_changes', 'suggest', 'A structure (notes, clusters, a diagram) proposed as one group of suggestions for editors to accept or reject.'],
  ['create_board', 'write', 'A new board in a personal or team workspace, optionally from a template.'],
  ['add_stickies', 'write', 'A titled grid of sticky notes.'],
  ['add_clusters', 'write', 'Titled groups side by side; existing notes can move into them.'],
  ['add_diagram', 'write', 'A Mermaid flowchart or sequence diagram, a mind map or tree from an outline, or a node-and-edge graph, laid out by Freero.'],
  ['update_items', 'write', 'Several items changed in one all-or-nothing step: text, fields, colours, frames, locks, links, position and size.'],
  ['delete_items', 'write', 'Deletes items, only with an explicit confirmation.'],
  ['create_doc', 'write', 'A new doc from Markdown, personal or in a team workspace.'],
  ['append_to_doc', 'write', 'Markdown added to the end of a doc; everyone with it open sees it arrive.'],
  ['post_status', 'write', 'The agent’s plan, status and tasks (to do, doing, done, blocked) on its lane of a control-room board; retries never duplicate.'],
  ['sync_to_tracker', 'write', 'Sends items to the board’s Jira, Linear or GitHub as one issue or one per item, kept in sync.'],
  ['add_comment', 'comment', 'A comment on the board or an item, or a reply in a thread.'],
];

export default definePage({
  path: '/agents',
  name: 'Build with agents',
  title: 'Build AI agents on Freero: MCP server, REST API, webhooks',
  ogTitle: 'An MCP whiteboard your agents can build on',
  description:
    'Freero’s remote MCP server, REST API and signed webhooks let your agents read boards, propose changes people approve and react to what the team does.',
  updated: '2026-10-28',
  body: () => (
    <>
      <Hero
        kicker="For builders"
        title="Give your agents a board to work on."
        lead="Freero is a whiteboard with a public contract for agents: a remote MCP server, a versioned REST API and signed webhooks. Agents act for a person, with that person’s access and nothing more, and people review what they propose."
        actions={
          <>
            <ButtonLink href="#mcp">MCP server</ButtonLink>
            <ButtonLink href="#api" variant="secondary">
              REST API
            </ButtonLink>
            <ButtonLink href="#webhooks" variant="secondary">
              Webhooks
            </ButtonLink>
          </>
        }
      />

      <Section id="mcp" title="The MCP server" lead="One endpoint for Claude, ChatGPT, Cursor, VS Code and any client that speaks MCP over Streamable HTTP.">
        <Code label="Endpoint">{MCP_URL}</Code>
        <div className="columns-2">
          <Checks
            kind="yes"
            items={[
              <>
                <strong>Stateless Streamable HTTP.</strong> Each <code>POST</code> is authenticated afresh and answered with JSON; any instance behind a load
                balancer answers any request.
              </>,
              <>
                <strong>OAuth 2.1 sign-in.</strong> Dynamic client registration, PKCE (S256) and tokens bound to the MCP server (RFC 8707). Or a personal access
                token as a bearer token.
              </>,
            ]}
          />
          <Checks
            kind="yes"
            items={[
              <>
                <strong>Read and suggest by default.</strong> Writing and commenting are scopes the person ticks on the consent screen.
              </>,
              <>
                <strong>Outcome-shaped tools.</strong> Agents send structure; Freero places it in free space with connectors attached. No coordinates.
              </>,
            ]}
          />
        </div>
        <div className="columns-2">
          <Code label="Cursor: ~/.cursor/mcp.json">{`{
  "mcpServers": {
    "freero": { "url": "${MCP_URL}" }
  }
}`}</Code>
          <Code label="VS Code: .vscode/mcp.json">{`{
  "servers": {
    "freero": { "type": "http", "url": "${MCP_URL}" }
  }
}`}</Code>
        </div>
        <Code label="Try it from a terminal with the MCP Inspector">{`npx @modelcontextprotocol/inspector --cli ${MCP_URL} --transport http \\
  --method tools/list --header "Authorization: Bearer frp_…"`}</Code>

        <h3>Tools</h3>
        <Table caption="Freero MCP tools and the permission each needs" head={['Tool', 'Needs', 'What it does']} rows={TOOLS.map(([t, n, d]) => [<code key={t}>{t}</code>, n, d])} />
        <p>
          <strong>Resource:</strong> <code>freero://board/{'{boardId}'}</code>, a board’s outline in the untrusted-content envelope. <strong>Prompts:</strong>{' '}
          <code>control_room</code>, <code>run_retro</code>, <code>notes_to_diagram</code>, <code>summarize_board</code>. <strong>Views (MCP Apps):</strong> a
          read-only board preview for outlines and the live board for <code>open_board</code>, both static HTML that fetches nothing itself. Item ids come from the outline. Full reference:{' '}
          <a href={docsUrl('docs/mcp.md')}>MCP server guide</a> and <a href={docsUrl('docs/board-outline.md')}>outline format</a>.
        </p>
      </Section>

      <Section id="api" tone="tint" title="The REST API" lead="Everything the MCP server does, and more, for scripts and services: versioned under /api/v1, additive-only within a version.">
        <Code label="Your first call">{`curl -H "Authorization: Bearer frp_…" ${abs('/api/v1/me')}`}</Code>
        <Cards cols={3}>
          <Card title="Boards and items">
            List, create and read boards; read the outline; create, change and delete items; insert laid-out structure; manage members.
          </Card>
          <Card title="Suggestions">
            Propose changes with <code>boards:suggest</code>, list them, and accept or reject them with <code>boards:write</code>.
          </Card>
          <Card title="Search and links">Search board content, resolve Freero links and find backlinks, always as the token’s person is allowed to see.</Card>
          <Card title="Personal tokens and OAuth apps">
            Tokens with chosen scopes and expiry, paused or revoked at will; OAuth apps with authorization code and PKCE for products other people connect.
          </Card>
          <Card title="Rules agents can rely on">
            Destructive calls need <code>confirm=true</code>; at most 500 items per create; a request and a write budget per token or app.
          </Card>
          <Card title="Attributed and audited">
            What a token or app creates is labelled “&lt;its name&gt; for &lt;you&gt;”, and every call is in the audit log with the credential that made it.
          </Card>
        </Cards>
        <p>
          The OpenAPI 3.1 reference is served by every Freero at <a href="/api/v1/openapi.json">/api/v1/openapi.json</a>. Guide:{' '}
          <a href={docsUrl('docs/api/README.md')}>REST API</a>.
        </p>
      </Section>

      <Section id="webhooks" title="Webhooks" lead="Workspace webhooks tell your systems what happened on a team’s boards, so agents can react to people instead of polling.">
        <div className="columns-2">
          <Checks
            kind="yes"
            items={[
              <>
                <strong>Events:</strong> boards created, renamed, moved, trashed and restored; members added, changed and removed; items created, updated and
                deleted; comments written.
              </>,
              <>
                <strong>Settled, not chatty:</strong> a two-second drag is one <code>item.updated</code>, a note typed into is one <code>item.created</code>.
              </>,
              <>
                <strong>Private stays private:</strong> drafts and hidden frames never produce events.
              </>,
            ]}
          />
          <Checks
            kind="yes"
            items={[
              <>
                <strong>Signed:</strong> HMAC-SHA256 in <code>Freero-Signature</code> with a timestamp, plus event and delivery ids.
              </>,
              <>
                <strong>Retried:</strong> up to seven attempts with backoff, a 30-day delivery log and “send again”.
              </>,
              <>
                <strong>Ready for chat:</strong> JSON, or messages formatted for Slack incoming webhooks and Microsoft Teams workflows.
              </>,
            ]}
          />
        </div>
        <p>
          Owners and admins of a team workspace add endpoints in the admin console. Contract and schema: <a href={docsUrl('docs/events.md')}>events and webhooks</a>.
        </p>
      </Section>

      <Section
        id="control-room"
        tone="tint"
        title="A board as your agents’ control room"
        lead="Coding agents, research agents and automations work for hours. A control-room board shows people what each one is doing and lets them steer it without a new tool."
      >
        <Steps>
          <Step title="Each agent gets a lane">
            A lane is a Plan note, a Status note and a Tasks kanban with To do, Doing, Done and Blocked. Start from the <em>Agent control room</em> template, or
            let the agent create the board on its first post. Several agents share a board, one lane each.
          </Step>
          <Step title="The agent posts as it works">
            After each step it calls <code>post_status</code>: the plan, a one-line status and its tasks by title. A retry never duplicates a card, and a
            blocked task lands in Blocked with the agent’s question on it.
          </Step>
          <Step title="People steer on the board">
            Drag a card back to To do to have it redone, move one out of Blocked to say go ahead, add a card, or comment. That is just using the whiteboard.
          </Step>
          <Step title="The agent picks it up">
            Before its next step, <code>get_feedback</code> returns exactly what people changed since the agent last looked, never its own moves. On team
            boards, workspace webhooks can push the same changes to the agent instead.
          </Step>
        </Steps>
        <p>
          The <code>control_room</code> prompt sets an agent up to work this way. What people write reaches the agent as untrusted board content, like every
          read.
        </p>
      </Section>

      <Section id="docs" title="Reference" narrow>
        <ul className="checks checks--yes">
          <li>
            <a href={docsUrl('docs/mcp.md')}>MCP server</a>: connecting clients, permissions, safety, every tool, how sign-in works.
          </li>
          <li>
            <a href={docsUrl('docs/board-outline.md')}>Board outline format</a>: what agents read.
          </li>
          <li>
            <a href={docsUrl('docs/api/README.md')}>REST API</a> and its <a href="/api/v1/openapi.json">OpenAPI reference</a>.
          </li>
          <li>
            <a href={docsUrl('docs/events.md')}>Events and webhooks</a>: the versioned event contract and delivery.
          </li>
          <li>
            <a href={docsUrl('docs/trackers.md')}>Issue trackers</a>: how board items and Jira, Linear or GitHub issues stay in sync.
          </li>
        </ul>
      </Section>
    </>
  ),
});

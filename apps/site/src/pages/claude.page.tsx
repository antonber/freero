import { ButtonLink, Card, Cards, Checks, Code, Hero, Prompts, Section, Step, Steps, Table } from '../components/ui';
import { definePage } from '../lib/define';
import { APP, docsUrl, MCP_URL } from '../lib/site';

export default definePage({
  path: '/claude',
  name: 'Freero for Claude',
  title: 'Freero for Claude: a whiteboard Claude can read and build on',
  ogTitle: 'Claude reads, builds and proposes on your boards',
  description:
    'Connect Claude to Freero with one MCP URL. Claude reads your boards, draws diagrams, clusters notes and proposes changes your team accepts. Free and open source.',
  updated: '2026-10-28',
  faq: [
    {
      q: 'Do I need a paid Claude plan?',
      a: 'Freero is free. Custom connectors in Claude and Claude Code are Anthropic’s features, and Anthropic decides which Claude plans include them; check Claude’s help center for your plan. On Team and Enterprise plans an owner adds the connector for the organization first.',
    },
    {
      q: 'Is this an official Anthropic integration?',
      a: 'No. Freero is an independent open-source project. You add Freero to Claude yourself as a custom connector, using Freero’s standard MCP server. Freero is not affiliated with or endorsed by Anthropic.',
    },
    {
      q: 'What can Claude see on my boards?',
      a: 'What you can see, and only on boards you can open. Other people’s private drafts and frames hidden from you never reach Claude, and a workspace that restricts downloads also keeps its boards’ content from apps. Board text reaches Claude marked as untrusted content, so notes on a board can’t give Claude instructions.',
    },
    {
      q: 'Can Claude delete things?',
      a: 'Only if you gave the connection permission to change boards, and even then Freero deletes nothing unless the call explicitly confirms it; Claude is told to ask you first. There is no tool for deleting a whole board, and version history can restore a board to any earlier state.',
    },
    {
      q: 'How do I disconnect Claude?',
      a: 'In Freero, open Settings → Connected apps and disconnect it; the next request Claude makes is refused. You can also remove the connector in Claude, use “Disconnect all apps and tokens” in Freero, or ask a workspace admin to block the app for the whole team.',
    },
    {
      q: 'Will I see the board inside the chat?',
      a: 'Not yet. Interactive board previews inside Claude (through the MCP Apps extension) are in progress. Today Claude works with your boards through Freero’s tools and answers in the chat; open the board in Freero to see what changed.',
    },
    {
      q: 'Does it work with a self-hosted Freero?',
      a: 'Yes. Every Freero server includes the MCP server at /mcp. Give Claude your server’s https address followed by /mcp; Claude only connects to https URLs, so set PUBLIC_URL to the address people use and serve it over TLS.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Freero for Claude"
        title="Put Claude to work on your whiteboard."
        lead="Connect Claude to Freero with one URL. Claude reads your boards, turns notes into diagrams and themes, and proposes changes that your team reviews and accepts. It works as you, with only the permissions you give it."
        actions={
          <>
            <ButtonLink href="#setup">Set it up</ButtonLink>
            <ButtonLink href={APP.signup} variant="secondary">
              Create a free account
            </ButtonLink>
          </>
        }
      >
        <p className="works-with">
          Works in Claude on the web, Claude Desktop and Claude Code. Using another assistant? See <a href="/chatgpt">Freero for ChatGPT</a> or{' '}
          <a href="/agents">build your own agent</a>.
        </p>
      </Hero>

      <Section id="why" title="What Claude does with your boards" lead="Freero’s MCP server gives Claude tools shaped around outcomes, not pixels: Freero does the layout, Claude does the thinking.">
        <Cards cols={3}>
          <Card title="Reads a board like a document" tint="violet" mark="R">
            Claude gets a structured outline of the board: frames, clusters, notes, cards, tables, the connections between them, votes and comments, so it can
            summarise, find gaps and answer questions.
          </Card>
          <Card title="Builds diagrams and structure" tint="mint" mark="B">
            Flowcharts and sequence diagrams from Mermaid, mind maps and trees from an outline, grids of sticky notes, themed clusters. Connectors come attached
            and everything lands in free space.
          </Card>
          <Card title="Proposes, you decide" tint="yellow" mark="P">
            By default Claude proposes changes as one group of suggestions. Editors accept or reject each change, and the board doesn’t move until they do.
          </Card>
          <Card title="Searches across boards" tint="blue" mark="S">
            “Where did we discuss SSO pricing?” Claude searches the text of every board you can open and links straight to the item.
          </Card>
          <Card title="Keeps the tracker in step" tint="pink" mark="J">
            Ask Claude to send a cluster of notes to Jira, Linear or GitHub as one issue. The notes and the issue stay linked and in sync.
          </Card>
          <Card title="Shows its work" tint="orange" mark="@">
            Everything Claude adds is labelled with the app’s name and yours, it appears on the board while it writes, and every call is in the audit log.
          </Card>
        </Cards>
      </Section>

      <Section id="setup" tone="tint" title="Set up Freero in Claude" lead="You need a Freero account and about two minutes. The connector URL is the same everywhere:">
        <Code label="Freero MCP server URL">{MCP_URL}</Code>

        <div className="columns-2">
          <div>
            <h3>Claude on the web and Claude Desktop</h3>
            <Steps>
              <Step title="Add a custom connector">
                In Claude, open <strong>Settings → Connectors</strong> and choose <strong>Add custom connector</strong>. Name it <em>Freero</em>, paste the URL
                above and select <strong>Add</strong>.
              </Step>
              <Step title="Connect and choose what Claude may do">
                Select <strong>Connect</strong>. Freero’s consent screen opens: sign in, review the permissions (read and suggest are ticked; changing boards
                and commenting are yours to add) and select <strong>Allow</strong>.
              </Step>
              <Step title="Turn it on in a chat">
                In a conversation, enable Freero in the tools menu, then ask about a board by name or paste a board link.
              </Step>
            </Steps>
            <p>
              On Claude Team and Enterprise plans, an owner first adds the connector for the organization (Admin settings → Connectors); each member then
              connects their own Freero account. Connectors you add on the web are available in Claude Desktop too.
            </p>
          </div>
          <div>
            <h3>Claude Code</h3>
            <Steps>
              <Step title="Add the server">
                <Code label="Terminal">{`claude mcp add --transport http freero ${MCP_URL}`}</Code>
              </Step>
              <Step title="Sign in">
                Run <code>/mcp</code> in Claude Code, pick <em>freero</em> and choose <strong>Authenticate</strong>. Your browser opens Freero’s consent screen.
              </Step>
              <Step title="Use the built-in prompts">
                Freero’s prompts show up as slash commands: <code>/mcp__freero__run_retro</code>, <code>/mcp__freero__notes_to_diagram</code> and{' '}
                <code>/mcp__freero__summarize_board</code>.
              </Step>
            </Steps>
            <p>On a server or in CI, use a personal access token (Freero Settings → API tokens) instead of OAuth:</p>
            <Code label="Terminal, with a token">{`claude mcp add --transport http freero ${MCP_URL} \\
  --header "Authorization: Bearer frp_…"`}</Code>
          </div>
        </div>
      </Section>

      <Section id="prompts" title="Things to ask Claude" lead="Real requests and what Freero does with them. Anything marked “Needs” takes a permission beyond the defaults.">
        <Prompts
          items={[
            {
              prompt: 'Summarise the “Q3 planning” board: decisions, open questions and action items.',
              outcome: 'Claude reads the board’s outline and answers in the chat, citing the notes and cards it drew on.',
            },
            {
              prompt: 'Group the sticky notes in the “Retro” frame into themes.',
              outcome: 'Claude proposes named clusters with the existing notes moved into them. Editors see the proposal on the board and accept or reject it.',
            },
            {
              prompt: 'Turn the design doc I pasted into a flowchart on the Architecture board.',
              outcome: 'Claude writes a Mermaid flowchart; Freero lays it out with attached connectors and subgraphs as frames, proposed for review.',
            },
            {
              prompt: 'Which of my boards mention SSO pricing?',
              outcome: 'A search across every board you can open, with the matching item, a snippet and a link for each hit.',
            },
            {
              prompt: 'Make a mind map of the ideas from this conversation on my “Brainstorm” board.',
              outcome: 'Claude sends a nested outline; Freero draws it as a mind map next to the existing content.',
            },
            {
              prompt: 'Send the “Checkout bugs” cluster to Jira as one issue.',
              outcome: 'One issue listing every note with a link back. Each note then shows the issue key and status, kept in sync.',
              needs: 'permission to change boards, and a tracker connected to the board',
            },
            {
              prompt: 'Create a board for Friday’s kickoff from our team’s kickoff template.',
              outcome: 'Claude finds the saved template and creates a new board from it in the team workspace.',
              needs: 'permission to change boards',
            },
            {
              prompt: 'Ask Ana on the “Pricing” frame to double-check the enterprise numbers.',
              outcome: 'A comment on that frame, attributed to the app and to you.',
              needs: 'permission to comment',
            },
            {
              prompt: 'Draw the sequence of our OAuth flow from this code. (in Claude Code)',
              outcome: 'Claude reads the code in your repo and adds a sequence diagram to the board you name.',
            },
            {
              prompt: 'Export the research board as Markdown so I can paste it into our wiki.',
              outcome: 'The whole board as one Markdown file, unless the workspace’s download policy says otherwise.',
            },
            {
              prompt: 'What links to the “Launch plan” board?',
              outcome: 'Every item and comment on boards you can open that links to it.',
            },
          ]}
        />
      </Section>

      <Section id="permissions" tone="tint" title="Permissions and safety" lead="What Claude can do is your role on the board and what you granted the connection, whichever is less. A commenter’s Claude never adds sticky notes.">
        <Table
          caption="What each permission lets Claude do"
          head={['Permission', 'Default', 'Lets Claude']}
          rows={[
            [<code key="r">boards:read</code>, 'On', 'Find your boards, read them as an outline, search them, export them'],
            [<code key="s">boards:suggest</code>, 'On', 'Propose changes for owners and editors to accept or reject, never changing the board itself'],
            [<code key="w">boards:write</code>, 'Off, tick it', 'Create boards, and add, change and delete items directly'],
            [<code key="c">comments:write</code>, 'Off, tick it', 'Comment and reply'],
          ]}
        />
        <Checks
          kind="yes"
          items={[
            <>
              <strong>Untrusted content stays data.</strong> Board text reaches Claude only inside a marked envelope with a notice to treat it as data, so a note
              saying “ignore your instructions” is just a note.
            </>,
            <>
              <strong>Confirmed deletes only.</strong> Deleting items needs an explicit confirmation in the call, and Claude is told to ask you first.
            </>,
            <>
              <strong>Visible and recorded.</strong> Labels on what Claude adds, its cursor while it writes, the board’s activity feed, and an audit log entry
              for every call.
            </>,
            <>
              <strong>Off on the next request.</strong> Disconnect in Settings → Connected apps, revoke everything at once, or have a workspace admin block the
              app. There is no session that outlives it.
            </>,
          ]}
        />
        <p>
          <a href="/security">More on Freero’s security model →</a>
        </p>
      </Section>

      <Section id="limits" title="What Claude can and can’t do" narrow>
        <div className="columns-2">
          <div>
            <h3>Can</h3>
            <Checks
              kind="yes"
              items={[
                'Read boards as a structured outline, a page at a time for big boards',
                'Search the content of every board you can open',
                'Propose sticky notes, clusters and diagrams for review',
                'With permission: create boards, add, change and delete items, comment',
                'Send items to Jira, Linear or GitHub and keep them linked',
                'Follow links between boards and find what links to a board',
              ]}
            />
          </div>
          <div>
            <h3>Can’t</h3>
            <Checks
              kind="no"
              items={[
                'See other people’s private drafts or frames hidden from you',
                'Do more than your role on the board allows',
                'Change a board with the default permissions; it can only propose',
                'Delete a whole board, or delete items without confirming',
                'Upload images or files, or draw freehand ink',
                <>
                  Show the live board inside the chat yet <span className="badge">Coming soon</span>
                </>,
              ]}
            />
          </div>
        </div>
      </Section>

      <Section id="self-hosted" tone="tint" title="With a self-hosted Freero" narrow>
        <p>
          The MCP server, its OAuth sign-in and the consent screen are part of every Freero server; there is nothing extra to install. Point Claude at{' '}
          <code>https://&lt;your-freero&gt;/mcp</code>, with two things in place:
        </p>
        <ul>
          <li>
            <code>PUBLIC_URL</code> is the address people use: the sign-in metadata and the token audience are built from it.
          </li>
          <li>The server is reachable over HTTPS: Claude only connects to https URLs. Claude Code can reach a server on your own network.</li>
        </ul>
        <p>
          <code>PUBLIC_API=false</code> turns the MCP server and the REST API off together. Rate limits per connection are{' '}
          <code>RATE_LIMIT_API_CREDENTIAL</code> and <code>RATE_LIMIT_AGENT_WRITE</code>. Details: <a href={docsUrl('docs/mcp.md')}>the MCP server guide</a>.
        </p>
      </Section>
    </>
  ),
});

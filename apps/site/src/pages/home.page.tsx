import { HeroArt } from '../components/HeroArt';
import { ButtonLink, Card, Cards, Hero, Section, Shot } from '../components/ui';
import { definePage } from '../lib/define';
import { softwareApplication } from '../lib/seo';
import { APP, MCP_URL } from '../lib/site';

export default definePage({
  path: '/',
  name: 'Home',
  title: 'Freero: the whiteboard for teams of people and AI agents',
  ogTitle: 'The whiteboard for teams of people and AI agents',
  description:
    'A free, open-source online whiteboard where your team and your AI agents work together. Connect Claude or ChatGPT over MCP. Sync Jira, Linear and GitHub.',
  updated: '2026-10-28',
  jsonLd: [softwareApplication()],
  faq: [
    {
      q: 'Is Freero really free?',
      a: 'Yes. There is no paid plan, no seat count and no feature behind a paywall: SSO, SCIM, the audit log and the admin console are included. The hosted service has fair-use limits (upload storage, request rates), listed on the pricing page. Freero is MIT licensed, so you can also run it on your own servers.',
    },
    {
      q: 'What does it mean that agents are teammates on a board?',
      a: 'An AI assistant you connect works on the board the way a colleague does, with your permissions: it reads the board, adds or proposes changes, shows up with its own cursor while it writes, and everything it adds is labelled with its name and yours, such as "Claude for Maria". By default it can only read and propose; people accept or reject what it suggests.',
    },
    {
      q: 'Which AI assistants and agents work with Freero?',
      a: 'Any client that speaks the Model Context Protocol (MCP) over HTTP: Claude (web, desktop and Claude Code), ChatGPT in developer mode, Cursor, VS Code with GitHub Copilot, and agents you build yourself. Scripts and services can use the REST API and webhooks instead.',
    },
    {
      q: 'Can an agent change my board without me knowing?',
      a: 'Not by default. A new connection can read boards and propose changes, nothing more; changing boards directly and commenting are separate permissions you tick on the consent screen. Whatever an agent does is labelled with its name, shown in the board’s activity feed and recorded in the audit log, and you can disconnect it at any time.',
    },
    {
      q: 'Does Freero send my boards to an AI model?',
      a: 'Only when someone asks it to, and only to the provider you chose. Freero has no model of its own. The built-in AI actions are off until an operator or a workspace admin connects a provider (Anthropic, OpenAI or any OpenAI-compatible endpoint, including one you run yourself). Agents you connect over MCP read what your permissions and the board allow, never other people’s private drafts.',
    },
    {
      q: 'Can I host Freero myself?',
      a: 'Yes. Freero is open source under the MIT licence and ships as one Docker image. A Docker Compose file runs the whole stack on one machine, and the same image scales out behind a load balancer with PostgreSQL, Redis and S3-compatible storage. The MCP server, REST API, tracker sync and SSO are part of every installation.',
    },
    {
      q: 'Does the Jira sync work with Jira Data Center?',
      a: 'Yes. Freero connects to Jira Cloud and to Jira Data Center or Server with a personal access token, as well as to Linear, GitHub and GitHub Enterprise Server. Changes flow both ways: from the board to the issue and from the issue back to the board.',
    },
  ],
  body: () => (
    <>
      <Hero
        title="The whiteboard for teams of people and AI agents."
        lead="Brainstorm, plan and diagram with your teammates and the agents you already use. Claude, ChatGPT, Cursor or your own agents join the board as real participants: they read it, propose changes you approve, and keep Jira in sync. Free and open source; use ours or host your own."
        actions={
          <>
            <ButtonLink href={APP.signup}>Start free</ButtonLink>
            <ButtonLink href="#connect" variant="secondary">
              Connect your agent
            </ButtonLink>
          </>
        }
        aside={<HeroArt />}
      >
        <p className="works-with">
          Set up in a few minutes: <a href="/claude">Claude</a> · <a href="/chatgpt">ChatGPT</a> · <a href="/agents#mcp">Cursor, VS Code and any MCP client</a>
        </p>
      </Hero>

      <Section id="how" title="How it works" lead="One board for the whole loop: people think together, an agent does the legwork, people decide, and the result lands in the tracker your team already uses." tone="tint">
        <ol className="strip">
          <li>
            <h3>Think together on the board</h3>
            <p>Sticky notes, frames, connectors and diagrams, live for everyone in the room or across time zones.</p>
            <Shot name="workshop" alt="A Freero board with a frame of sticky notes from a product retro, with two collaborators’ cursors." />
          </li>
          <li>
            <h3>Ask your agent</h3>
            <p>“Group these notes into themes.” Claude, ChatGPT or your own agent reads the board and works out a proposal.</p>
            <Shot name="proposal" alt="An agent’s proposal on a Freero board: new notes shown as ghosts, labelled with the agent’s and the person’s names." />
          </li>
          <li>
            <h3>Review what it proposes</h3>
            <p>Nothing changes until someone accepts. Take the whole proposal, part of it, or none, and undo it in one step.</p>
            <Shot name="review" alt="The suggestions list on a Freero board, with Accept and Reject for each change an agent proposed." />
          </li>
          <li>
            <h3>Send it to the tracker</h3>
            <p>A cluster of notes becomes one Jira, Linear or GitHub issue with a link back to every note, and both stay in sync.</p>
            <Shot name="tracker" alt="Sticky notes on a Freero board showing the linked issue’s key and status." />
          </li>
        </ol>
      </Section>

      <Section
        id="teammates"
        title="Agents work on the board like teammates"
        lead="You always know what an agent did, for whom, and why it was allowed to. And you stay the one who decides."
      >
        <Cards>
          <Card title="Present on the board" mark="◎" tint="violet">
            While an agent writes, it appears in the board’s presence list with its own cursor and selection, so people see where it is working.
          </Card>
          <Card title="“Claude for Maria”" mark="@" tint="mint">
            Every item an agent creates carries its name and the name of the person it works for: on the item, in the activity feed and in the board outline.
          </Card>
          <Card title="Suggestions you accept" mark="✓" tint="yellow">
            By default agents propose instead of changing things. Owners and editors see the proposal as ghosts on the board and accept or reject each change, or all of it.
          </Card>
          <Card title="One step to undo" mark="↶" tint="pink">
            Accepting a proposal is a single step in your undo history, and version history can bring back any earlier state of the board.
          </Card>
          <Card title="Every call on record" mark="≡" tint="blue">
            Each tool call is in the audit log with the app, the person it acted for, the board and the outcome: the team’s log for team boards.
          </Card>
          <Card title="Limits per agent" mark="⏱" tint="orange">
            Each connection has its own request and write budget, separate from people’s editing, so a runaway agent never slows the room down.
          </Card>
        </Cards>
      </Section>

      <Section
        id="connect"
        tone="tint"
        title="Bring any agent"
        lead={
          <>
            One MCP endpoint for every assistant, plus a REST API and webhooks for everything else. Your board’s address is{' '}
            <code>{MCP_URL}</code>.
          </>
        }
      >
        <Cards cols={4}>
          <Card title="Claude" href="/claude" mark="C" tint="orange">
            Add Freero as a custom connector in Claude, or with one command in Claude Code. Claude reads, builds and proposes on your boards.
          </Card>
          <Card title="ChatGPT" href="/chatgpt" mark="G" tint="mint">
            Connect Freero in ChatGPT’s developer mode and work on your boards from a chat, with the same permissions and the same review.
          </Card>
          <Card title="Cursor, VS Code and other clients" href="/agents#mcp" mark="{}" tint="blue">
            Any client that speaks MCP over HTTP signs in with OAuth, or uses a personal access token on a server.
          </Card>
          <Card title="Your own agents" href="/agents" mark="⚙" tint="violet">
            The REST API, OAuth apps and signed webhooks let your services read boards, propose changes and react to what people do.
          </Card>
        </Cards>
        <p className="note">
          <strong>Built-in AI on your own model.</strong> Freero’s AI actions (generate ideas, cluster, summarise, diagram from text) run on the provider you
          choose: Anthropic, OpenAI or any OpenAI-compatible endpoint, including a model you host. You pay your provider directly; Freero adds no AI surcharge.
        </p>
      </Section>

      <Section id="safety" title="Safe by design" lead="Agents get exactly the access you give them, and board content can’t talk them into more.">
        <Cards>
          <Card title="Read and suggest by default">
            A new connection can read and propose. Changing boards directly and commenting are opt-in, and never go beyond your own role on the board.
          </Card>
          <Card title="Board text is data, not instructions">
            Everything people wrote reaches an agent inside a marked, untrusted envelope, so a sticky note can’t pose as instructions from you.
          </Card>
          <Card title="Private stays private">
            An agent sees the board as the person it works for does: other people’s private drafts and frames hidden from them never leave the server.
          </Card>
          <Card title="Scoped, revocable tokens">
            OAuth 2.1 with PKCE, tokens bound to the MCP server, and personal tokens with exactly the permissions you pick. Pause or revoke any of them.
          </Card>
          <Card title="Kill switches at every level">
            Disconnect one app, all of yours at once, block an app for a whole team, or turn the API off for the instance. Effective on the next request.
          </Card>
          <Card title="Deletes need a yes">
            Destructive calls do nothing unless the agent confirms explicitly, and agents are told to ask you first.
          </Card>
        </Cards>
        <p>
          <a href="/security">How Freero keeps boards and agents secure →</a>
        </p>
      </Section>

      <Section id="trackers" tone="tint" title="From board to done" lead="Planning ends up in the tracker. Freero keeps the board and the issues in step, in both directions.">
        <div className="columns-2">
          <ul className="checks checks--yes">
            <li>
              <strong>A cluster becomes one issue.</strong> Send a group of sticky notes as a single issue that lists every note with a link back, or one
              issue per note.
            </li>
            <li>
              <strong>Fields survive the trip.</strong> Title, description, labels, status, assignee, start and due dates and estimates map to the tracker’s
              own fields.
            </li>
            <li>
              <strong>Live on the board.</strong> Each linked note or card shows the issue’s key, status and assignee, updated when the issue changes.
            </li>
          </ul>
          <ul className="checks checks--yes">
            <li>
              <strong>Jira Cloud and Jira Data Center</strong>, <strong>Linear</strong>, and <strong>GitHub</strong> including GitHub Enterprise Server.
            </li>
            <li>
              <strong>Import issues as cards</strong> from a query, or onto a timeline as a roadmap with lanes per epic, team or label.
            </li>
            <li>
              <strong>Agents can do it too:</strong> ask Claude or ChatGPT to send a cluster to Jira and it uses the same sync.
            </li>
          </ul>
        </div>
      </Section>

      <Section id="whiteboard" title="The full whiteboard" lead="Everything a team expects from an online whiteboard, built in and free.">
        <Cards cols={4}>
          <Card title="Infinite canvas">Pan and zoom, frames, snapping and alignment guides, minimap, groups, locks, copy and paste between boards.</Card>
          <Card title="Notes, shapes and ink">Sticky notes, text, shape sets for flowcharts, UML, BPMN, ERD, networks and wireframes, an icon library, pen and highlighter.</Card>
          <Card title="Diagrams">Attached, labelled connectors, mind maps, swimlanes, auto-layout and org charts, and diagrams from Mermaid text.</Card>
          <Card title="Structured content">Tables with typed columns and a board view, kanban columns, task cards, timelines and Gantt bars, code blocks.</Card>
          <Card title="Real-time together">Live cursors and selections, follow someone, bring everyone to you, reactions, comments with mentions and notifications.</Card>
          <Card title="Present and share">Slides made from frames with layouts and speaker notes, presentation mode, roles per board, share links with a password or expiry.</Card>
          <Card title="Files and media">Images, PDFs, video and audio that play on the board, file cards, link previews and live embeds of allow-listed tools.</Card>
          <Card title="Templates and export">More than 70 original templates. Export to PNG, JPG, SVG or PDF, CSV for notes and cards, version history.</Card>
        </Cards>
        <p className="works-with">
          Keyboard and screen-reader support aims at WCAG 2.1 AA, with a “board as list” view; it works on phones and tablets and installs as an app.
        </p>
      </Section>

      <Section id="workshops" tone="tint" title="Built for workshops" lead="Facilitation tools that keep a session honest and moving, with no extra app to buy.">
        <Cards cols={3}>
          <Card title="Private mode" tint="violet" mark="◐">
            Everyone writes alone until the facilitator reveals all notes at once. The server keeps drafts from other participants, not just the screen.
          </Card>
          <Card title="Dot voting" tint="yellow" mark="●">
            A set number of votes per person, hidden until the results are shown, then a ranked list.
          </Card>
          <Card title="Planning poker" tint="mint" mark="5">
            Estimate cards one by one with Fibonacci, T-shirt or custom decks; picks stay sealed until the reveal and the agreed value lands on the card.
          </Card>
          <Card title="Guided retros" tint="pink" mark="↻">
            Write privately under a timer, reveal and group, vote, discuss, and turn the result into action-item cards.
          </Card>
          <Card title="Polls and Q&A" tint="blue" mark="?">
            Polls, word clouds, rankings, rating scales and Q&A, answered from the board or a phone, with results drawn on the board.
          </Card>
          <Card title="Timer, laser and follow" tint="orange" mark="⏲">
            A shared countdown, a laser pointer, presenter notes, and an audience that follows the presenter. Guests can join by link without an account.
          </Card>
        </Cards>
      </Section>

      <Section id="enterprise" title="Enterprise-grade, and still free" lead="The controls a security review asks for are part of every Freero, not an upsell.">
        <Cards cols={4}>
          <Card title="Single sign-on">SAML 2.0 and OpenID Connect per workspace, verified domains, and SSO you can enforce.</Card>
          <Card title="SCIM provisioning">SCIM 2.0 users and groups from your identity provider, with deprovisioning that ends sessions and tokens.</Card>
          <Card title="Audit log">Append-only and hash-chained per workspace, with filters, CSV or JSON export and an integrity check.</Card>
          <Card title="Admin console">Members and roles, sharing and download policies, session limits, API and app controls, usage.</Card>
          <Card title="Retention">Per-workspace retention for the trash, version history and the audit log.</Card>
          <Card title="GDPR exports">Personal and whole-workspace data exports, and self-service account deletion.</Card>
          <Card title="MIT licence">Read the code, change it, run it. No open-core edition, no licence key.</Card>
          <Card title="Self-host">One Docker image, from a laptop to several instances behind a load balancer.</Card>
        </Cards>
        <p>
          <a href="/security">Security details</a> · <a href="/open-source">Open source and self-hosting</a> · <a href="/pricing">What free means</a>
        </p>
      </Section>
    </>
  ),
});

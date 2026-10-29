import { ButtonLink, Card, Cards, Checks, Code, Hero, Prompts, Section, Step, Steps, Table } from '../components/ui';
import { definePage } from '../lib/define';
import { APP, docsUrl, MCP_URL } from '../lib/site';

export default definePage({
  path: '/chatgpt',
  name: 'Freero for ChatGPT',
  title: 'Freero for ChatGPT: connect a whiteboard to ChatGPT',
  ogTitle: 'Work on your whiteboard from a ChatGPT chat',
  description:
    'Connect Freero to ChatGPT in developer mode. ChatGPT reads and searches your boards and proposes notes and diagrams your team approves. Free, open source.',
  updated: '2026-10-28',
  faq: [
    {
      q: 'What do I need to turn on in ChatGPT?',
      a: 'Developer mode, under Settings → Apps & Connectors → Advanced settings. It lets you add connectors that aren’t in ChatGPT’s directory, such as Freero. OpenAI decides which plans offer developer mode, and in Business, Enterprise and Edu workspaces an admin may have to allow custom connectors first.',
    },
    {
      q: 'Is Freero listed in ChatGPT’s app directory?',
      a: 'No. You add Freero yourself as a custom connector in developer mode, using its MCP server URL. Freero is an independent open-source project, not affiliated with or endorsed by OpenAI.',
    },
    {
      q: 'Does ChatGPT see everything on my boards?',
      a: 'It sees the boards you can open, the way you see them. Other people’s private drafts and frames hidden from you stay on Freero’s server, and a workspace that restricts downloads keeps its boards’ content from apps. Board text is handed over as untrusted data, never as instructions.',
    },
    {
      q: 'Can ChatGPT change a board on its own?',
      a: 'Not with the default permissions: it can read and propose, and people who can edit the board accept or reject each proposal. If you tick “change boards” on Freero’s consent screen, it can add and edit items directly, never beyond your own role, and it still can’t delete anything without an explicit confirmation.',
    },
    {
      q: 'How do I see what ChatGPT did?',
      a: 'Everything it adds is labelled with the app’s name and yours on the board and in the activity feed, it shows up on the board while it writes, and every call is in the audit log with its outcome.',
    },
    {
      q: 'Can the board show up inside ChatGPT?',
      a: 'Yes, where ChatGPT shows interactive app views. Freero implements MCP Apps, so asking to open a board shows the real, live board in the conversation, with your access level, Full screen, Open in Freero and Share with team. The view can’t do more than the connection: with the default permissions it is view only.',
    },
    {
      q: 'Can I connect ChatGPT to my own Freero server?',
      a: 'Yes, if ChatGPT can reach it: the server needs a public https address set as PUBLIC_URL. Use that address followed by /mcp as the connector URL.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Freero for ChatGPT"
        title="Your whiteboard, one message away in ChatGPT."
        lead="Add Freero as a connector in ChatGPT’s developer mode. Ask about a board, turn a pasted list into sticky notes, or have ChatGPT sketch a flowchart, and review what it proposes before anything changes."
        actions={
          <>
            <ButtonLink href="#setup">Connect ChatGPT</ButtonLink>
            <ButtonLink href={APP.signup} variant="secondary">
              Create a free account
            </ButtonLink>
          </>
        }
      >
        <p className="works-with">
          Also on <a href="/claude">Claude</a>, and on any MCP client: <a href="/agents#mcp">Cursor, VS Code and your own agents</a>.
        </p>
      </Hero>

      <Section id="why" title="Why connect ChatGPT to a whiteboard" lead="A chat is good at turning words into structure. A board is where your team looks at that structure together. Freero joins the two.">
        <Cards cols={3}>
          <Card title="Ask questions about a board" tint="mint" mark="?">
            ChatGPT reads the board as a structured outline (frames, clusters, notes, cards, tables, connections, votes and comments) and answers in the chat.
          </Card>
          <Card title="Turn text into a board" tint="violet" mark="→">
            Meeting notes become a grid of sticky notes; a process description becomes a flowchart; a plan becomes a mind map. Freero does the layout.
          </Card>
          <Card title="Review before it lands" tint="yellow" mark="✓">
            By default ChatGPT can only propose. Proposals appear on the board as ghosts labelled with the app’s name and yours, and editors accept or reject them.
          </Card>
          <Card title="Find anything" tint="blue" mark="⌕">
            Search the content of all your boards from the chat, with a link to each matching item.
          </Card>
          <Card title="From notes to issues" tint="pink" mark="↗">
            Send cards to Linear, Jira or GitHub, one issue each or one per cluster, and keep them linked to the board.
          </Card>
          <Card title="The live board in the chat" tint="violet" mark="▣">
            Where ChatGPT shows interactive app views, it can bring up the real board in the conversation for you to look at, edit if allowed, and share.
          </Card>
          <Card title="Notes into docs" tint="mint" mark="D">
            ChatGPT can turn a conversation into a Freero doc, append to one, or read the docs your team keeps next to its boards.
          </Card>
          <Card title="On the record" tint="orange" mark="≡">
            Every call is in the audit log, and you can cut the connection off from Freero at any time.
          </Card>
        </Cards>
      </Section>

      <Section id="setup" tone="tint" title="Connect Freero to ChatGPT" lead="ChatGPT adds custom connectors in developer mode. Here is the whole path, start to finish.">
        <Code label="MCP server URL to paste into ChatGPT">{MCP_URL}</Code>
        <Steps>
          <Step title="Turn on developer mode">
            In ChatGPT on the web, open <strong>Settings → Apps &amp; Connectors → Advanced settings</strong> and switch on <strong>Developer mode</strong>.
            Your plan has to offer it; in a Business, Enterprise or Edu workspace, an admin may need to allow custom connectors first.
          </Step>
          <Step title="Create the Freero connector">
            Back in <strong>Apps &amp; Connectors</strong>, choose <strong>Create</strong>. Name it <em>Freero</em>, paste the MCP server URL above, set
            authentication to <strong>OAuth</strong> and select <strong>Create</strong>.
          </Step>
          <Step title="Sign in to Freero and pick permissions">
            ChatGPT sends you to Freero’s consent screen. Sign in and look at what the app asks for: reading and suggesting are ticked, changing boards and
            commenting are off unless you tick them. Select <strong>Allow</strong>.
          </Step>
          <Step title="Use it in a chat">
            In a new chat, open the tools menu, choose developer mode and pick <em>Freero</em>. Then name a board or paste a board link and ask away.
          </Step>
        </Steps>
        <p className="note">
          Freero labels its read-only tools as read-only and its delete tool as destructive (standard MCP annotations), so clients such as ChatGPT can tell
          calls that only read from calls that change something.
        </p>
      </Section>

      <Section id="prompts" title="Try these in ChatGPT" lead="Each request with what it does on the board. “Needs” marks a permission you have to tick on the consent screen.">
        <Prompts
          items={[
            {
              prompt: 'Read the “Customer interviews” board and list the five pain points that come up most, with a quote for each.',
              outcome: 'ChatGPT reads the outline and answers in the chat, quoting the notes it used.',
            },
            {
              prompt: 'Here are my meeting notes. Put the action items on the “Team sync” board as sticky notes.',
              outcome: 'A titled grid of notes, one per action item, proposed for an editor to accept.',
            },
            {
              prompt: 'Cluster the notes in the “Ideas” frame by theme and suggest a name for each cluster.',
              outcome: 'Named groups with the existing notes moved into them, as a proposal on the board.',
            },
            {
              prompt: 'Turn this onboarding process into a flowchart on the Ops board.',
              outcome: 'A flowchart with attached connectors, laid out by Freero in free space next to the existing content.',
            },
            {
              prompt: 'Which of my boards talk about onboarding?',
              outcome: 'Matches from titles, notes, cards, tables, tags and comments across your boards, each with a link.',
            },
            {
              prompt: 'Build a mind map of our Q4 goals on a new board in the Product workspace.',
              outcome: 'A new board in that workspace with the goals drawn as a mind map.',
              needs: 'permission to change boards',
            },
            {
              prompt: 'List the decisions recorded on the architecture board.',
              outcome: 'ChatGPT reads the board and lists the decisions with the item each one came from.',
            },
            {
              prompt: 'Send every card in the “Ready” column to Linear, one issue per card.',
              outcome: 'One Linear issue per card. Each card shows its issue’s key and status, and both sides stay in sync.',
              needs: 'permission to change boards, and Linear connected to the board',
            },
            {
              prompt: 'Reply to Maria’s comment on the pricing frame with a short summary of the three options.',
              outcome: 'A reply in that comment thread, labelled with the app’s name and yours.',
              needs: 'permission to comment',
            },
            {
              prompt: 'Show me the Roadmap board.',
              outcome: 'Where ChatGPT shows app views, the live board opens in the chat, and Share with team gives you a link to pass on.',
            },
            {
              prompt: 'Append today’s decisions to the “Decision log” doc.',
              outcome: 'The decisions added at the end of the doc; anyone with it open sees them arrive.',
              needs: 'permission to change boards',
            },
            {
              prompt: 'Group the sprint 14 retro into themes and suggest three actions as cards.',
              outcome: 'Themed clusters and three action cards, proposed together for the team to accept.',
            },
          ]}
        />
      </Section>

      <Section id="permissions" tone="tint" title="Permissions and safety" lead="ChatGPT acts as you, and never with more than your role on the board allows.">
        <Table
          caption="Permissions on Freero’s consent screen"
          head={['Permission', 'Default', 'What ChatGPT may do']}
          rows={[
            [<code key="r">boards:read</code>, 'On', 'List and open your boards, read and search them, export them'],
            [<code key="s">boards:suggest</code>, 'On', 'Propose changes that owners and editors accept or reject'],
            [<code key="w">boards:write</code>, 'Off', 'Create boards and change items directly'],
            [<code key="c">comments:write</code>, 'Off', 'Write comments and replies'],
          ]}
        />
        <div className="columns-2">
          <Checks
            kind="yes"
            items={[
              'Board text is wrapped as untrusted data, so notes can’t give ChatGPT orders',
              'Deleting items needs an explicit confirmation in the call',
              'At most 500 items per call, and a write budget per connection',
            ]}
          />
          <Checks
            kind="yes"
            items={[
              'Everything it adds is labelled with the app’s name and yours',
              'Recorded in the audit log, call by call',
              'Disconnect from Freero’s Settings → Connected apps, effective at once',
            ]}
          />
        </div>
        <p>
          <a href="/security">Freero’s security model in detail →</a>
        </p>
      </Section>

      <Section id="limits" title="What ChatGPT can and can’t do here" narrow>
        <div className="columns-2">
          <div>
            <h3>Can</h3>
            <Checks
              kind="yes"
              items={[
                'Read and search the boards you can open',
                'Propose sticky notes, clusters, mind maps and flowcharts',
                'Create boards and edit items, when you allow it',
                'Comment and reply, when you allow it',
                'Create linked issues in Jira, Linear or GitHub',
                'Export a board as Markdown or JSON',
                'Open the live board in the chat, where ChatGPT shows app views',
                'Create and add to docs, when you allow it',
              ]}
            />
          </div>
          <div>
            <h3>Can’t</h3>
            <Checks
              kind="no"
              items={[
                'Reach boards you can’t open, or content hidden from you',
                'Act beyond your role, whatever you granted',
                'Delete a board, or delete items without confirming',
                'Add images or files to a board',
                'Share a board on its own: only your click on “Share with team” in the live view does that',
              ]}
            />
          </div>
        </div>
      </Section>

      <Section id="self-hosted" tone="tint" title="Using your own Freero server" narrow>
        <p>
          ChatGPT connects from OpenAI’s servers, so your Freero has to be reachable from the internet over HTTPS. Set <code>PUBLIC_URL</code> to that
          address (the sign-in metadata is built from it) and use <code>https://&lt;your-freero&gt;/mcp</code> as the connector URL. No other setup: the MCP
          server and its consent screen ship with every Freero.
        </p>
        <p>
          Prefer to keep your server on a private network? Use an MCP client that runs on your machine, such as Claude Code or Cursor. More in{' '}
          <a href={docsUrl('docs/mcp.md')}>the MCP server guide</a>.
        </p>
      </Section>
    </>
  ),
});

// Freero's catalog of everything that connects (#87): the one list the app's "Apps & agents" page
// (/apps) and the marketing site's /integrations pages are built from. Pure data.
//
// Every entry must be true of the code: what it says works, works on a Freero server today. Facts
// come from the code and docs/ (mcp.md, trackers.md, events.md, configuration.md, operations.md),
// never from plans. The checks (apps/site/src/integrations.test.ts) fail when an entry's in-app
// link names a route, tab or section the web app doesn't have, its docs link names a file or
// heading that doesn't exist, or the embeds here differ from EMBED_PROVIDERS.
//
// Third parties are named in plain text only: no logos, no brand colours (Freero's own brand).
//
// Adding an integration: add one entry to its category's list below. Nothing else changes: the app
// page, its search, the site's index and the entry's own site page all follow.
import { EMBED_PROVIDERS, type EmbedProvider } from './api';

export type IntegrationCategory = 'agents' | 'trackers' | 'chat' | 'embeds' | 'calls' | 'identity' | 'automation' | 'storage';

export const INTEGRATION_CATEGORIES: ReadonlyArray<{ id: IntegrationCategory; label: string; blurb: string }> = [
  { id: 'agents', label: 'AI agents', blurb: 'Assistants and coding agents that work on your boards through Freero’s MCP server, as you and with the permissions you give them.' },
  { id: 'trackers', label: 'Issue trackers', blurb: 'Board items become issues and stay linked both ways: key, status and assignee on the board, edits synced.' },
  { id: 'chat', label: 'Chat', blurb: 'What happens on a team’s boards, posted to a channel as it happens.' },
  { id: 'embeds', label: 'Embeds', blurb: 'Paste a link on a board and it plays or opens live, in a sandboxed frame.' },
  { id: 'calls', label: 'Calls', blurb: 'A board keeps its meeting link, so everyone joins the same call from the top bar.' },
  { id: 'identity', label: 'Sign-in and directory', blurb: 'Sign in with an existing account, single sign-on for a team’s domain, and provisioning from its directory.' },
  { id: 'automation', label: 'Automation', blurb: 'Scripts, services and your own apps, through the REST API and signed webhooks.' },
  { id: 'storage', label: 'Storage', blurb: 'Where a self-hosted Freero keeps uploaded files.' },
];

/**
 * How it is turned on:
 * - `built-in`  works on every board, nothing to connect;
 * - `settings`  a person connects it in their settings, or a team’s owner or admin in its admin console;
 * - `api`       you build on it with the REST API (a token or an OAuth app);
 * - `operator`  the person who runs the Freero server sets it up (environment variables).
 */
export type IntegrationStatus = 'built-in' | 'settings' | 'api' | 'operator';

export const INTEGRATION_STATUS_LABEL: Record<IntegrationStatus, string> = {
  'built-in': 'Built in',
  settings: 'Connect in settings',
  api: 'Via the API',
  operator: 'Set up by the server’s operator',
};

/**
 * An in-app deep link. `path` is a route of the web app, with an optional `#section` or `?tab=`.
 * `/admin/:workspace?tab=…` is a team's admin console: the app offers it for each team the person
 * administers (it can't be one fixed URL).
 */
export interface IntegrationAppLink {
  path: string;
  label: string;
}

/** A file in the repository's docs (and optionally one of its headings, as GitHub anchors it). */
export interface IntegrationDocsLink {
  file: string;
  anchor?: string;
  label: string;
}

export interface Integration {
  /** Stable slug: the app's /apps/<id> and the site's /integrations/<id>. */
  id: string;
  /** Plain-text name. */
  name: string;
  category: IntegrationCategory;
  /** One line, ≤ 110 characters, for cards and search results. */
  oneLiner: string;
  /** Plain-text paragraphs. */
  description: string[];
  status: IntegrationStatus;
  /** The connect step: what to do, in order, then where to do it. */
  connect: {
    steps: string[];
    app?: IntegrationAppLink;
    docs?: IntegrationDocsLink;
  };
  /** When the server's operator must turn something on first (environment variables, docs/configuration.md). */
  operatorSetup?: string;
  /** Extra words people search for (other names, what it is for). */
  keywords: string[];
  /** The site's page for it: unique title ≤ 60 and description ≤ 155 characters. */
  seo: { title: string; description: string };
  /** An embed entry names the provider it describes (EMBED_PROVIDERS), so the two lists can't drift. */
  embedProvider?: EmbedProvider['id'];
}

// ---------------------------------------------------------------------------------------------
// AI agents and MCP clients. Each links to its tab of the Connect page (/settings/connect#<client>,
// app/pages/connect/clients.ts) and to its section of docs/mcp.md.

const AGENTS: Integration[] = [
  {
    id: 'claude',
    name: 'Claude',
    category: 'agents',
    oneLiner: 'Claude on the web and Claude Desktop reads, maps out and edits your boards as a custom connector.',
    description: [
      'Add Freero to Claude as a custom connector and ask about any board you can open: summarize it, group its notes into themes, turn notes into a diagram, or propose changes for your team to accept.',
      'Claude acts as you, with only what you allow on Freero’s consent screen: reading and suggesting by default, changing boards and commenting if you tick them. In hosts that show interactive views, open_board shows the board live in the conversation.',
    ],
    status: 'settings',
    connect: {
      steps: [
        'In Claude, open Customize → Connectors and add a custom connector named Freero with your server’s MCP URL.',
        'Select Connect, sign in to Freero and choose what Claude may do.',
        'In a chat, turn Freero on in the tools menu and ask about a board.',
      ],
      app: { path: '/settings/connect#claude', label: 'Connect Claude' },
      docs: { file: 'docs/mcp.md', anchor: 'claude-claudeai-claude-desktop', label: 'Claude setup in the MCP guide' },
    },
    keywords: ['anthropic', 'connector', 'mcp', 'assistant', 'claude desktop', 'claude.ai'],
    seo: {
      title: 'Claude integration: connect Claude to Freero boards',
      description: 'Add Freero to Claude as a custom connector: Claude reads, summarizes and maps out your whiteboards, acting only with the permissions you grant.',
    },
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    category: 'agents',
    oneLiner: 'ChatGPT works on your boards as a custom MCP server, with the permissions you grant it.',
    description: [
      'Add Freero to ChatGPT as a custom MCP server, then mention it in a chat to find boards, read them, add notes, clusters and diagrams, or propose changes.',
      'OpenAI decides which plans can add custom MCP servers; in a workspace an admin may have to allow them first. ChatGPT connects from OpenAI’s servers, so your Freero must be reachable over public https.',
    ],
    status: 'settings',
    connect: {
      steps: [
        'In ChatGPT, open Plugins and add a custom MCP server named Freero with your server’s MCP URL and OAuth sign-in.',
        'Sign in to Freero on the consent screen and choose what ChatGPT may do.',
        'In a new chat, type @, pick Freero and ask about a board.',
      ],
      app: { path: '/settings/connect#chatgpt', label: 'Connect ChatGPT' },
      docs: { file: 'docs/mcp.md', anchor: 'chatgpt', label: 'ChatGPT setup in the MCP guide' },
    },
    keywords: ['openai', 'gpt', 'plugin', 'mcp', 'assistant'],
    seo: {
      title: 'ChatGPT integration: use Freero boards in ChatGPT',
      description: 'Connect ChatGPT to Freero as a custom MCP server to find, read and add to your whiteboards from a chat, with read and suggest access by default.',
    },
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    category: 'agents',
    oneLiner: 'Your coding agent reads plans from boards and posts its progress to a control-room lane.',
    description: [
      'One command adds Freero to Claude Code. The agent can read a board’s outline, turn a plan into task cards, send items to your issue tracker, and post its plan, status and tasks to its own lane of a control-room board where people steer it.',
      'On a server or in CI, where no browser can open for sign-in, give it a personal access token instead.',
    ],
    status: 'settings',
    connect: {
      steps: ['Run claude mcp add --transport http freero with your server’s MCP URL.', 'In Claude Code, run /mcp, pick freero and choose Authenticate.'],
      app: { path: '/settings/connect#claude-code', label: 'Connect Claude Code' },
      docs: { file: 'docs/mcp.md', anchor: 'claude-code', label: 'Claude Code setup in the MCP guide' },
    },
    keywords: ['anthropic', 'coding agent', 'cli', 'terminal', 'control room', 'mcp'],
    seo: {
      title: 'Claude Code integration: plan and report on Freero',
      description: 'Add Freero to Claude Code with one command: your coding agent reads boards, creates task cards and posts its progress to a lane people can steer.',
    },
  },
  {
    id: 'cursor',
    name: 'Cursor',
    category: 'agents',
    oneLiner: 'Install Freero in Cursor with one link; its agent reads and adds to your boards.',
    description: [
      'The Connect page builds Cursor’s one-click install link with your server’s address in it, or gives you the mcp.json entry to paste. Cursor then asks you to sign in to Freero.',
    ],
    status: 'settings',
    connect: {
      steps: ['Open the install link from the Connect page (or add Freero to mcp.json).', 'Sign in to Freero when Cursor asks, and choose what it may do.'],
      app: { path: '/settings/connect#cursor', label: 'Connect Cursor' },
      docs: { file: 'docs/mcp.md', anchor: 'cursor', label: 'Cursor setup in the MCP guide' },
    },
    keywords: ['ide', 'editor', 'coding agent', 'mcp.json', 'mcp'],
    seo: {
      title: 'Cursor integration: Freero boards in your editor',
      description: 'Install Freero’s MCP server in Cursor with one link, so its agent can read your whiteboards, add cards and diagrams, and report what it did.',
    },
  },
  {
    id: 'vscode',
    name: 'VS Code',
    category: 'agents',
    oneLiner: 'GitHub Copilot’s agent mode in VS Code uses Freero’s tools after a one-click install.',
    description: [
      'Install Freero in VS Code (or VS Code Insiders) from the Connect page, from a terminal with code --add-mcp, or in .vscode/mcp.json. The first time Copilot uses it, VS Code opens your browser to sign in to Freero.',
    ],
    status: 'settings',
    connect: {
      steps: ['Open the install link from the Connect page.', 'Sign in to Freero in your browser the first time Copilot calls it.'],
      app: { path: '/settings/connect#vscode', label: 'Connect VS Code' },
      docs: { file: 'docs/mcp.md', anchor: 'vs-code-github-copilot', label: 'VS Code setup in the MCP guide' },
    },
    keywords: ['visual studio code', 'copilot', 'github copilot', 'ide', 'mcp'],
    seo: {
      title: 'VS Code integration: Freero for GitHub Copilot',
      description: 'Add Freero to VS Code with one click and let GitHub Copilot’s agent mode read your whiteboards and add to them, with the permissions you choose.',
    },
  },
  {
    id: 'codex',
    name: 'Codex',
    category: 'agents',
    oneLiner: 'Codex (CLI, IDE extension and desktop) adds Freero as a remote MCP server in config.toml.',
    description: ['Add Freero to ~/.codex/config.toml with your server’s MCP URL, then sign in with codex mcp login freero.'],
    status: 'settings',
    connect: {
      steps: ['Add the [mcp_servers.freero] entry from the Connect page to ~/.codex/config.toml.', 'Run codex mcp login freero and approve it on Freero’s consent screen.'],
      app: { path: '/settings/connect#other', label: 'Connect Codex' },
      docs: { file: 'docs/mcp.md', anchor: 'codex-windsurf-and-other-clients', label: 'Codex setup in the MCP guide' },
    },
    keywords: ['openai', 'coding agent', 'cli', 'config.toml', 'mcp'],
    seo: {
      title: 'Codex integration: connect Codex to Freero',
      description: 'Add Freero to Codex as a remote MCP server in config.toml and sign in once: the agent reads your boards and posts its plan and progress there.',
    },
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    category: 'agents',
    oneLiner: 'Windsurf (Devin Desktop) reaches Freero from Cascade’s MCP configuration.',
    description: ['Add Freero to Cascade’s raw MCP configuration with your server’s MCP URL as serverUrl; it signs in with your Freero account the first time it calls.'],
    status: 'settings',
    connect: {
      steps: ['In Cascade’s MCP settings, open the raw config and add the entry from the Connect page.', 'Approve it on Freero’s consent screen when it first connects.'],
      app: { path: '/settings/connect#other', label: 'Connect Windsurf' },
      docs: { file: 'docs/mcp.md', anchor: 'codex-windsurf-and-other-clients', label: 'Windsurf setup in the MCP guide' },
    },
    keywords: ['devin', 'devin desktop', 'cascade', 'ide', 'mcp'],
    seo: {
      title: 'Windsurf integration: Freero in Cascade',
      description: 'Connect Windsurf (Devin Desktop) to Freero through Cascade’s MCP configuration, so its agent can read and add to your whiteboards.',
    },
  },
  {
    id: 'mcp-client',
    name: 'Any MCP client',
    category: 'agents',
    oneLiner: 'Any client that speaks MCP over Streamable HTTP connects to the same address.',
    description: [
      'Freero is a remote MCP server (Streamable HTTP, stateless) with OAuth 2.1 sign-in and dynamic client registration, so a client registers itself and you approve it on the consent screen. Clients that only run local servers can reach it through the mcp-remote bridge.',
      'Scripts and headless agents can send a personal access token as a bearer token instead.',
    ],
    status: 'settings',
    connect: {
      steps: ['Give your client the MCP URL from the Connect page.', 'Approve it on Freero’s consent screen, or send a personal access token.'],
      app: { path: '/settings/connect#other', label: 'Get the MCP address' },
      docs: { file: 'docs/mcp.md', label: 'The MCP guide' },
    },
    keywords: ['model context protocol', 'streamable http', 'mcp-remote', 'oauth', 'agent', 'llm', 'tools'],
    seo: {
      title: 'MCP server for whiteboards: connect any agent to Freero',
      description: 'Freero is a remote MCP server with OAuth sign-in: any MCP client can find, read and add to your boards with only the permissions you grant.',
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Issue trackers (modules/trackers, docs/trackers.md). A person connects their own in Settings;
// a team's owners and admins connect the team's in its admin console.

const trackerConnect = (name: string, credential: string) => ({
  steps: [
    `In Settings → Your issue trackers (or your team’s admin console → Issue trackers), add a ${name} connection with ${credential}. Freero tests it before keeping it.`,
    'Add the webhook Freero shows in the tracker, so its changes reach the board at once.',
    'On a board, select notes or cards and choose Send to tracker…, or use Import issues… in the board menu.',
  ],
  app: { path: '/settings#trackers', label: 'Connect your own' },
  docs: { file: 'docs/trackers.md', anchor: 'connecting', label: 'Connecting a tracker' },
});

const TRACKERS: Integration[] = [
  {
    id: 'jira-cloud',
    name: 'Jira Cloud',
    category: 'trackers',
    oneLiner: 'Send notes and cards to Jira as issues, import issues as cards, and keep both in sync.',
    description: [
      'A cluster of sticky notes becomes one Jira issue listing each note with a link back, or each item becomes its own issue. Title, description, labels, status, assignee, dates and story points are kept, and each item shows the issue’s key, status and assignee, live.',
      'Changes flow both ways through Jira’s webhooks. Connect with an API token and the account’s email, or with OAuth when the server’s operator registered an Atlassian app.',
    ],
    status: 'settings',
    connect: trackerConnect('Jira Cloud', 'your site address, an API token and its account’s email'),
    keywords: ['atlassian', 'jql', 'issues', 'tickets', 'sprint', 'backlog', 'sync'],
    seo: {
      title: 'Jira Cloud integration: sync whiteboards with Jira',
      description: 'Turn sticky notes and cards into Jira Cloud issues and import issues as linked cards. Status, assignee and fields stay in sync both ways.',
    },
  },
  {
    id: 'jira-data-center',
    name: 'Jira Data Center',
    category: 'trackers',
    oneLiner: 'The same two-way sync for Jira Data Center and Server, with a personal access token.',
    description: [
      'Freero talks to Jira Data Center and Server through REST v2 with a personal access token, writes descriptions in wiki markup, and follows the workflow’s transitions for status. Changes arrive by webhook where the version supports it, otherwise by polling.',
      'A Jira on a private network needs the server’s operator to allow private tracker addresses.',
    ],
    status: 'settings',
    connect: trackerConnect('Jira Data Center', 'its base URL and a personal access token'),
    keywords: ['atlassian', 'jira server', 'on-premises', 'self-hosted', 'jql', 'issues'],
    seo: {
      title: 'Jira Data Center integration for whiteboards',
      description: 'Link board items to Jira Data Center or Server issues with a personal access token: two-way sync by webhook or polling, fields kept.',
    },
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'trackers',
    oneLiner: 'Board items become Linear issues, and Linear’s changes come back to the board.',
    description: [
      'Send notes, clusters or cards to a Linear team as issues, or import a search as linked cards. Title, description, labels, status, assignee, due date and estimate are kept in step, both ways, through Linear’s webhooks.',
    ],
    status: 'settings',
    connect: trackerConnect('Linear', 'a personal API key'),
    keywords: ['issues', 'tickets', 'cycles', 'projects', 'sync'],
    seo: {
      title: 'Linear integration: whiteboard notes to Linear issues',
      description: 'Send sticky notes and cards from a Freero board to Linear as issues, import issues as linked cards, and keep status and fields in sync.',
    },
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'trackers',
    oneLiner: 'Board items become GitHub issues, open or closed in step with their cards.',
    description: [
      'Send items to a repository as issues and import a GitHub search (for example repo:owner/name is:open) as linked cards. Title, description, labels and open or closed state sync both ways; GitHub Enterprise Server works the same way with its own address.',
      'Freero writes only its own section of an issue’s body, between markers, so the rest of the description is left alone.',
    ],
    status: 'settings',
    connect: trackerConnect('GitHub', 'a fine-grained token with read and write access to issues'),
    keywords: ['github enterprise', 'issues', 'repository', 'repo', 'sync'],
    seo: {
      title: 'GitHub Issues integration: whiteboards to issues',
      description: 'Turn board notes and cards into GitHub issues and import issues as linked cards, kept in sync both ways. GitHub Enterprise Server too.',
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Chat (modules/webhooks, docs/events.md "Formats"): a team's webhooks in a chat app's format.

const CHAT: Integration[] = [
  {
    id: 'slack',
    name: 'Slack',
    category: 'chat',
    oneLiner: 'Board activity posted to a Slack channel through an incoming webhook.',
    description: [
      'A team’s owner or admin adds a webhook in the Slack format and picks the events: a board created or renamed, items added or changed, comments written. Each becomes one sentence in the channel with a link to the item; board text is escaped, so it can’t make links or @channel pings.',
      'Webhooks only ever tell a channel about boards the whole team can open: never personal boards or private projects.',
    ],
    status: 'settings',
    connect: {
      steps: [
        'In Slack, create an incoming webhook for the channel.',
        'In your team’s admin console → Webhooks, add an endpoint with that URL, the Slack format and the events you want.',
      ],
      app: { path: '/admin/:workspace?tab=webhooks', label: 'Open Webhooks' },
      docs: { file: 'docs/events.md', anchor: 'formats', label: 'Webhook formats' },
    },
    operatorSetup: 'Webhooks are on unless the server’s operator set WEBHOOKS=false.',
    keywords: ['notifications', 'channel', 'incoming webhook', 'messages'],
    seo: {
      title: 'Slack integration: whiteboard activity in Slack',
      description: 'Post what happens on your team’s Freero boards to a Slack channel: new items, changes and comments, each with a link, through an incoming webhook.',
    },
  },
  {
    id: 'microsoft-teams',
    name: 'Microsoft Teams',
    category: 'chat',
    oneLiner: 'Board activity posted to a Teams channel as an Adaptive Card with an Open board button.',
    description: [
      'Create a Workflows webhook in Teams (When a Teams webhook request is received, then post to a channel) and add it in your team’s admin console in the Teams format. Each event arrives as an Adaptive Card with an Open board button.',
    ],
    status: 'settings',
    connect: {
      steps: [
        'In Teams, create a Workflows flow that starts “When a Teams webhook request is received” and posts to a channel.',
        'In your team’s admin console → Webhooks, add an endpoint with its URL and the Teams format.',
      ],
      app: { path: '/admin/:workspace?tab=webhooks', label: 'Open Webhooks' },
      docs: { file: 'docs/events.md', anchor: 'formats', label: 'Webhook formats' },
    },
    operatorSetup: 'Webhooks are on unless the server’s operator set WEBHOOKS=false.',
    keywords: ['teams', 'microsoft', 'workflows', 'adaptive card', 'notifications', 'channel'],
    seo: {
      title: 'Microsoft Teams integration: board updates in Teams',
      description: 'Send your team’s Freero board activity to a Microsoft Teams channel as Adaptive Cards through a Workflows webhook, each with an Open board button.',
    },
  },
  {
    id: "discord",
    name: "Discord",
    category: 'chat',
    oneLiner: "Board activity posted to a Discord channel as an embed with a link to the item.",
    description: [
      "A team’s owner or admin adds a webhook in the Discord format and picks the events. Each arrives as one embed: the sentence, the quoted text and a link to the item. Board text is escaped and mentions are switched off, so nothing on a board can ping @everyone.",
      "Webhooks only ever tell a channel about boards the whole team can open: never personal boards or private projects.",
    ],
    status: 'settings',
    connect: {
      steps: [
        "In Discord, open the channel’s settings → Integrations → Webhooks, create one and copy its URL.",
        "In your team’s admin console → Webhooks, add an endpoint with that URL, the Discord format and the events you want.",
      ],
      app: { path: '/admin/:workspace?tab=webhooks', label: 'Open Webhooks' },
      docs: { file: 'docs/events.md', anchor: 'formats', label: 'Webhook formats' },
    },
    operatorSetup: 'Webhooks are on unless the server’s operator set WEBHOOKS=false.',
    keywords: ["discord", "notifications", "channel", "webhook", "community"],
    seo: {
      title: "Discord integration: whiteboard activity in Discord",
      description: "Post what happens on your team’s Freero boards to a Discord channel through a channel webhook: new items, changes and comments, each with a link.",
    },
  },
  {
    id: "google-chat",
    name: "Google Chat",
    category: 'chat',
    oneLiner: "Board activity posted to a Google Chat space as a text message with a link.",
    description: [
      "A team’s owner or admin adds a webhook in the Google Chat format and picks the events. Each arrives as a short text message with a link to the item; angle brackets in board text are neutralised, so it can’t create links or mention everyone.",
      "Webhooks only ever tell a channel about boards the whole team can open: never personal boards or private projects.",
    ],
    status: 'settings',
    connect: {
      steps: [
        "In Google Chat, open the space → Apps & integrations → Webhooks, add one and copy its URL.",
        "In your team’s admin console → Webhooks, add an endpoint with that URL, the Google Chat format and the events you want.",
      ],
      app: { path: '/admin/:workspace?tab=webhooks', label: 'Open Webhooks' },
      docs: { file: 'docs/events.md', anchor: 'formats', label: 'Webhook formats' },
    },
    operatorSetup: 'Webhooks are on unless the server’s operator set WEBHOOKS=false.',
    keywords: ["google chat", "google workspace", "spaces", "notifications", "webhook"],
    seo: {
      title: "Google Chat integration: board updates in a space",
      description: "Send your team’s Freero board activity to a Google Chat space through an incoming webhook: new items, changes and comments, each with a link.",
    },
  },
  {
    id: "mattermost",
    name: "Mattermost",
    category: 'chat',
    oneLiner: "Board activity posted to a Mattermost channel, with @channel-style pings neutralised.",
    description: [
      "A team’s owner or admin adds a webhook in the Mattermost format and picks the events. Each arrives as a Markdown message with a link; board text is escaped and @ is replaced, so nothing on a board can ping @channel, @all or @here.",
      "Webhooks only ever tell a channel about boards the whole team can open: never personal boards or private projects.",
    ],
    status: 'settings',
    connect: {
      steps: [
        "In Mattermost, go to Integrations → Incoming Webhooks, add one for the channel and copy its URL.",
        "In your team’s admin console → Webhooks, add an endpoint with that URL, the Mattermost format and the events you want.",
      ],
      app: { path: '/admin/:workspace?tab=webhooks', label: 'Open Webhooks' },
      docs: { file: 'docs/events.md', anchor: 'formats', label: 'Webhook formats' },
    },
    operatorSetup: 'Webhooks are on unless the server’s operator set WEBHOOKS=false.',
    keywords: ["mattermost", "self-hosted chat", "notifications", "incoming webhook", "channel"],
    seo: {
      title: "Mattermost integration: board updates in a channel",
      description: "Post your team’s Freero board activity to a Mattermost channel through an incoming webhook, with escaping that keeps board text from pinging everyone.",
    },
  },
  {
    id: 'slack-unfurls',
    name: 'Slack link previews',
    category: 'chat',
    oneLiner: "A Freero board link pasted in Slack unfolds into its title and thumbnail, when the board is public.",
    description: [
      "The server’s operator creates a Slack app from Freero’s manifest and sets two secrets. After that, a Freero board link pasted in a Slack workspace that installed the app shows a preview.",
      "Only a board anyone with its link may open (no password, not expired) shows its title, description and thumbnail. Every other link, and a link to a board that doesn’t exist, gets the same generic “Sign in to Freero to view it” card, so a preview never reveals a private board.",
    ],
    status: 'operator',
    connect: {
      steps: [
        "Run npm run admin -- slack:manifest on the server and create a Slack app from the manifest it prints.",
        "Install the app to your Slack workspace, then set SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN on the server and restart it.",
      ],
      docs: { file: 'docs/integrations/slack.md', label: 'Slack link previews' },
    },
    operatorSetup: "Off by default: needs SLACK_SIGNING_SECRET and SLACK_BOT_TOKEN on the server.",
    keywords: ['slack', 'unfurl', 'link preview', 'thumbnail', 'chat.unfurl'],
    seo: {
      title: 'Slack link previews for whiteboards',
      description: "Paste a public Freero board link in Slack and see its title and thumbnail; private boards show a generic card that reveals nothing.",
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Embeds: one entry per built-in provider of EMBED_PROVIDERS (the CSP frame-src mirrors it). A board
// stores the pasted link; the frame's address is rebuilt from it on the provider's own embed host.

const EMBED_DOCS: IntegrationDocsLink = { file: 'docs/configuration.md', anchor: 'live-embeds', label: 'Live embeds' };
const embed = (
  provider: EmbedProvider['id'],
  { links, name, ...e }: Omit<Integration, 'category' | 'status' | 'connect' | 'embedProvider' | 'name'> & { links: string; name?: string },
): Integration => ({
  ...e,
  name: name ?? EMBED_PROVIDERS.find((p) => p.id === provider)?.name ?? provider,
  category: 'embeds',
  status: 'built-in',
  embedProvider: provider,
  connect: {
    steps: [`Paste ${links} on a board.`, 'Press play on its card (or open its live view): it runs in a sandboxed frame, right on the board.'],
    app: { path: '/app', label: 'Open your boards' },
    docs: EMBED_DOCS,
  },
});

const EMBEDS: Integration[] = [
  embed('youtube', {
    id: 'youtube',
    oneLiner: 'YouTube videos play on the board, from the start time in the link.',
    description: ['Paste a YouTube link (watch, shorts, live or youtu.be) and it plays in a privacy-enhanced player on the board, starting where the link says.'],
    links: 'a YouTube link',
    keywords: ['video', 'player', 'youtu.be', 'shorts'],
    seo: {
      title: 'YouTube on a whiteboard: embed videos in Freero',
      description: 'Paste a YouTube link on a Freero board and the video plays right there, in a privacy-enhanced player that starts at the time in the link.',
    },
  }),
  embed('vimeo', {
    id: 'vimeo',
    oneLiner: 'Vimeo videos play on the board.',
    description: ['Paste a Vimeo link and the video plays in Vimeo’s own player, inside the board.'],
    links: 'a Vimeo link',
    keywords: ['video', 'player'],
    seo: {
      title: 'Vimeo on a whiteboard: embed Vimeo videos in Freero',
      description: 'Paste a Vimeo link on a Freero board to play the video in Vimeo’s own player, right next to the notes about it.',
    },
  }),
  embed('loom', {
    id: 'loom',
    oneLiner: 'Loom recordings play where the team discusses them.',
    description: ['Paste a Loom share link and the recording plays on the board, next to the notes and comments about it.'],
    links: 'a Loom share link',
    keywords: ['video', 'screen recording', 'async'],
    seo: {
      title: 'Loom on a whiteboard: play Loom videos in Freero',
      description: 'Paste a Loom share link on a Freero board and the recording plays in place, next to the notes and comments your team adds about it.',
    },
  }),
  embed('figma', {
    id: 'figma',
    oneLiner: 'Figma designs, prototypes and FigJam boards, live in Figma’s embed viewer.',
    description: ['Paste a link to a Figma design file, prototype or FigJam board, with or without a node, and it opens in Figma’s embed viewer on the board. Who can see it is still up to Figma’s own sharing.'],
    links: 'a Figma file, prototype or FigJam link',
    keywords: ['design', 'prototype', 'figjam', 'mockup', 'ui'],
    seo: {
      title: 'Figma embeds: designs and prototypes on Freero boards',
      description: 'Paste a Figma design, prototype or FigJam link on a Freero board to show it live in Figma’s embed viewer; Figma’s sharing decides who sees it.',
    },
  }),
  embed('google', {
    id: 'google-docs',
    name: 'Google Docs, Sheets, Slides and Forms',
    oneLiner: 'Google Docs, Sheets, Slides and Forms, live on the board.',
    description: [
      'Paste the link of a shared Google Docs, Sheets or Slides file, or a published copy of one or of a form, and it opens in Google’s own preview or embed view. A shared file shows to the people Google lets open it; a published copy to everyone.',
    ],
    links: 'a Google Docs, Sheets, Slides or Forms link',
    keywords: ['google sheets', 'google slides', 'google forms', 'spreadsheet', 'presentation', 'document', 'workspace'],
    seo: {
      title: 'Google Docs, Sheets and Slides on a whiteboard',
      description: 'Paste a Google Docs, Sheets, Slides or Forms link on a Freero board to show it live in Google’s own preview, next to your notes.',
    },
  }),
  embed('codepen', {
    id: 'codepen',
    oneLiner: 'CodePen pens run on the board, showing their result.',
    description: ['Paste a CodePen pen link and it runs in CodePen’s embed, result tab first, so a design review can try the real thing.'],
    links: 'a CodePen pen link',
    keywords: ['code', 'demo', 'html', 'css', 'javascript', 'prototype'],
    seo: {
      title: 'CodePen embeds: run pens on a Freero whiteboard',
      description: 'Paste a CodePen pen on a Freero board and it runs in place, showing its result, so reviews and workshops can try the real thing.',
    },
  }),
  embed('codesandbox', {
    id: 'codesandbox',
    oneLiner: 'CodeSandbox previews run on the board.',
    description: ['Paste a CodeSandbox link and its preview runs on the board in CodeSandbox’s embed.'],
    links: 'a CodeSandbox link',
    keywords: ['code', 'sandbox', 'demo', 'prototype', 'react'],
    seo: {
      title: 'CodeSandbox embeds: live previews on a whiteboard',
      description: 'Paste a CodeSandbox link on a Freero board to run its preview in place, next to the notes and comments about it.',
    },
  }),
];

// ---------------------------------------------------------------------------------------------
// Calls (modules/boards call.ts, features/call): Freero carries no audio or video itself.

const CALLS: Integration[] = [
  {
    id: 'meeting-link',
    name: 'Meeting link',
    category: 'calls',
    oneLiner: 'A board keeps its Zoom, Google Meet or Microsoft Teams link; Join call opens it.',
    description: [
      'An editor pastes the meeting link once (board menu → Call link…), and everyone on the board gets a Join call button in the top bar, with who is in the call. Any https meeting link works: Zoom, Google Meet, Microsoft Teams, Webex and others.',
      'The link is sealed at rest, because meeting links often carry their passcode. Freero carries no audio or video itself.',
    ],
    status: 'built-in',
    connect: {
      steps: ['On a board, open the board menu → Call link…, choose Meeting link and paste it.', 'Everyone on the board then joins from Join call in the top bar.'],
      app: { path: '/app', label: 'Open your boards' },
      docs: { file: 'docs/configuration.md', anchor: 'board-calls', label: 'Board calls' },
    },
    keywords: ['zoom', 'google meet', 'microsoft teams', 'webex', 'video call', 'meeting', 'join call'],
    seo: {
      title: 'Zoom, Meet and Teams calls from a whiteboard',
      description: 'Keep a board’s Zoom, Google Meet or Microsoft Teams link on the board: everyone joins the same call from the top bar and sees who is in it.',
    },
  },
  {
    id: 'jitsi',
    name: 'Jitsi',
    category: 'calls',
    oneLiner: 'Every board can have its own Jitsi room, with a name nobody can guess.',
    description: [
      'When the server’s operator points Freero at a Jitsi deployment (the public meet.jit.si or your own), an editor can give a board its own Jitsi room. The room name is derived from the board with the server’s secret, so knowing one board’s room tells nobody another’s.',
    ],
    status: 'built-in',
    connect: {
      steps: ['On a board, open the board menu → Call link… and choose Jitsi room.'],
      app: { path: '/app', label: 'Open your boards' },
      docs: { file: 'docs/configuration.md', anchor: 'board-calls', label: 'Board calls' },
    },
    operatorSetup: 'The server’s operator sets JITSI_BASE_URL; without it, boards use meeting links only.',
    keywords: ['jitsi meet', 'video call', 'open source', 'meeting room'],
    seo: {
      title: 'Jitsi integration: a video room for every board',
      description: 'Give each Freero board its own Jitsi room on meet.jit.si or your own deployment, with room names nobody can guess from the board.',
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Sign-in and directory (modules/auth oidc.ts, modules/sso, modules/scim).

const IDENTITY: Integration[] = [
  {
    id: 'google-sign-in',
    name: 'Sign in with Google',
    category: 'identity',
    oneLiner: 'Sign in to Freero with a Google account.',
    description: [
      'With Google sign-in on, people sign in with their Google account (OpenID Connect with PKCE). A Google account connects to an existing Freero account only when Google vouches for the address, and only after that account’s two-step verification.',
    ],
    status: 'settings',
    connect: {
      steps: ['Choose Continue with Google on the sign-in page, or connect Google under Settings → Sign-in methods.'],
      app: { path: '/settings#sign-in', label: 'Open sign-in methods' },
      docs: { file: 'docs/configuration.md', anchor: 'sign-in-with-google--microsoft-openid-connect', label: 'Sign in with Google or Microsoft' },
    },
    operatorSetup: 'The server’s operator sets OIDC_GOOGLE_CLIENT_ID and OIDC_GOOGLE_CLIENT_SECRET.',
    keywords: ['google account', 'oidc', 'openid connect', 'login', 'single sign-on'],
    seo: {
      title: 'Sign in with Google to Freero',
      description: 'Sign in to Freero with your Google account over OpenID Connect; accounts connect only on an address Google verified, after two-step verification.',
    },
  },
  {
    id: 'microsoft-sign-in',
    name: 'Sign in with Microsoft',
    category: 'identity',
    oneLiner: 'Sign in to Freero with a work, school or personal Microsoft account.',
    description: [
      'With Microsoft sign-in on, people sign in with their Microsoft Entra or personal Microsoft account. The operator can limit it to work and school accounts or to one organization.',
    ],
    status: 'settings',
    connect: {
      steps: ['Choose Continue with Microsoft on the sign-in page, or connect Microsoft under Settings → Sign-in methods.'],
      app: { path: '/settings#sign-in', label: 'Open sign-in methods' },
      docs: { file: 'docs/configuration.md', anchor: 'sign-in-with-google--microsoft-openid-connect', label: 'Sign in with Google or Microsoft' },
    },
    operatorSetup: 'The server’s operator sets OIDC_MICROSOFT_CLIENT_ID and OIDC_MICROSOFT_CLIENT_SECRET.',
    keywords: ['microsoft entra', 'azure ad', 'office 365', 'oidc', 'login', 'work account'],
    seo: {
      title: 'Sign in with Microsoft to Freero',
      description: 'Sign in to Freero with a Microsoft Entra work or school account or a personal Microsoft account, over OpenID Connect.',
    },
  },
  {
    id: 'saml-sso',
    name: 'SAML single sign-on',
    category: 'identity',
    oneLiner: 'Your team’s identity provider signs people in at your verified domain.',
    description: [
      'A team verifies its domain with a DNS record, then connects its SAML 2.0 identity provider in the admin console. Sign-ins at that domain go to the provider; signed assertions, audience, recipient and replay are checked. Owners can enforce SSO, which also refuses API tokens and apps made without it.',
    ],
    status: 'settings',
    connect: {
      steps: ['In your team’s admin console → Single sign-on, verify your domain with the TXT record shown.', 'Paste your identity provider’s metadata, test a sign-in, then enforce SSO if you want.'],
      app: { path: '/admin/:workspace?tab=sso', label: 'Open Single sign-on' },
      docs: { file: 'docs/operations.md', anchor: 'workspace-single-sign-on-and-provisioning', label: 'Single sign-on and provisioning' },
    },
    keywords: ['sso', 'saml 2.0', 'identity provider', 'idp', 'okta', 'microsoft entra', 'enterprise'],
    seo: {
      title: 'SAML SSO for Freero: sign in with your identity provider',
      description: 'Connect your team’s SAML 2.0 identity provider to Freero for your verified domain, and enforce single sign-on for everyone there.',
    },
  },
  {
    id: 'oidc-sso',
    name: 'OpenID Connect single sign-on',
    category: 'identity',
    oneLiner: 'Single sign-on for your team’s domain through an OpenID Connect provider.',
    description: [
      'Instead of SAML, a team can connect an OpenID Connect provider by issuer, client id and secret. The same domain verification, enforcement and break-glass owner rules apply.',
    ],
    status: 'settings',
    connect: {
      steps: ['In your team’s admin console → Single sign-on, verify your domain.', 'Choose OpenID Connect and enter the issuer, client id and secret.'],
      app: { path: '/admin/:workspace?tab=sso', label: 'Open Single sign-on' },
      docs: { file: 'docs/operations.md', anchor: 'workspace-single-sign-on-and-provisioning', label: 'Single sign-on and provisioning' },
    },
    keywords: ['sso', 'oidc', 'oauth', 'identity provider', 'idp', 'enterprise'],
    seo: {
      title: 'OpenID Connect SSO for your team on Freero',
      description: 'Sign your team in to Freero through an OpenID Connect provider at your verified domain, with the option to enforce single sign-on.',
    },
  },
  {
    id: 'scim',
    name: 'SCIM provisioning',
    category: 'identity',
    oneLiner: 'Your directory adds people, maps groups to roles and deactivates leavers.',
    description: [
      'Freero serves SCIM 2.0 at /scim/v2 with a token per workspace. Directories such as Okta and Microsoft Entra provision people at your verified domains, map groups to a workspace role or a project, and deprovision people, which closes the workspace’s boards to them at once.',
    ],
    status: 'settings',
    connect: {
      steps: ['In your team’s admin console → Provisioning, create a SCIM token (shown once).', 'Give your directory the SCIM URL and the token, then map its groups to roles or projects.'],
      app: { path: '/admin/:workspace?tab=provisioning', label: 'Open Provisioning' },
      docs: { file: 'docs/operations.md', anchor: 'workspace-single-sign-on-and-provisioning', label: 'Single sign-on and provisioning' },
    },
    keywords: ['scim 2.0', 'directory', 'okta', 'microsoft entra', 'provisioning', 'deprovisioning', 'groups'],
    seo: {
      title: 'SCIM provisioning for Freero teams',
      description: 'Provision and deprovision people from your directory with SCIM 2.0, and map directory groups to Freero workspace roles or projects.',
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Automation (modules/api, modules/apiauth, modules/webhooks; docs/api, docs/events.md).

const AUTOMATION: Integration[] = [
  {
    id: 'rest-api',
    name: 'REST API',
    category: 'automation',
    oneLiner: 'Read boards and add to them from scripts and services, with a token or an OAuth app.',
    description: [
      'Freero’s versioned REST API at /api/v1 covers boards, items, the board outline, comments, members, search, docs, suggestions and the issue-tracker hand-off. Every Freero server publishes its OpenAPI description at /api/v1/openapi.json.',
      'A personal access token does what you can, limited to the scopes you pick; an OAuth app acts for each person who approves it. Every call is in the audit log, and a team’s admins can turn API access off.',
    ],
    status: 'api',
    connect: {
      steps: ['Make a personal access token in Settings → API tokens (shown once), with the scopes you need.', 'Send it as Authorization: Bearer to /api/v1.'],
      app: { path: '/settings#api-tokens', label: 'Make a token' },
      docs: { file: 'docs/api/README.md', label: 'The REST API guide' },
    },
    operatorSetup: 'On unless the server’s operator set PUBLIC_API=false.',
    keywords: ['rest', 'http', 'openapi', 'token', 'scripts', 'sdk', 'developer'],
    seo: {
      title: 'Freero REST API: automate your whiteboards',
      description: 'Read boards, add items, comments and docs, and search from scripts with Freero’s versioned REST API, a personal token or an OAuth app.',
    },
  },
  {
    id: 'oauth-apps',
    name: 'Your own OAuth app',
    category: 'automation',
    oneLiner: 'Register an app that people connect to their Freero account on a consent screen.',
    description: [
      'Register an OAuth 2.1 app (authorization code with PKCE, public or with a secret) with its redirect addresses. People who connect it see its name and what it may do on Freero’s consent screen, and can revoke it at any time. Built something people can use? Submit it as a community listing.',
    ],
    status: 'api',
    connect: {
      steps: ['Register the app in Settings → Your OAuth apps, with its redirect addresses.', 'Send people through /oauth/authorize; exchange the code at /api/oauth/token.'],
      app: { path: '/settings#developer-apps', label: 'Register an app' },
      docs: { file: 'docs/api/README.md', label: 'The REST API guide' },
    },
    keywords: ['oauth 2.1', 'pkce', 'developer', 'consent', 'third-party app', 'client id'],
    seo: {
      title: 'Build a Freero app with OAuth 2.1',
      description: 'Register an OAuth 2.1 app with PKCE so people can connect it to their Freero account on a consent screen and revoke it any time.',
    },
  },
  {
    id: 'webhooks',
    name: 'Webhooks',
    category: 'automation',
    oneLiner: 'Signed events about a team’s boards, sent to your endpoint as they happen.',
    description: [
      'A team’s owners and admins register https endpoints for the events they want: boards created, renamed or trashed, members added, items created, changed or deleted, comments written. Each delivery is signed with HMAC-SHA256, retried with backoff and listed in a delivery log; an endpoint can be scoped to one board or one agent’s lane.',
    ],
    status: 'settings',
    connect: {
      steps: ['In your team’s admin console → Webhooks, add an endpoint, pick the events and copy the signing secret (shown once).', 'Check the Freero-Signature header on every delivery.'],
      app: { path: '/admin/:workspace?tab=webhooks', label: 'Open Webhooks' },
      docs: { file: 'docs/events.md', label: 'Events and webhooks' },
    },
    operatorSetup: 'On unless the server’s operator set WEBHOOKS=false.',
    keywords: ['events', 'hmac', 'callbacks', 'push', 'automation', 'integration'],
    seo: {
      title: 'Freero webhooks: signed events from your boards',
      description: 'Get signed, retried events when your team’s Freero boards change: items, comments, members and board lifecycle, scoped to a board if you like.',
    },
  },
  {
    id: 'meeting-notes',
    name: 'Meeting notes import',
    category: 'automation',
    oneLiner: "Notes or a transcript from your meeting tool become a frame: decisions, action-item cards and notes.",
    description: [
      "Paste or upload a Markdown or plain-text summary (the kind Granola, Fathom, Otter or Meetily export) or drop a .vtt or .srt transcript. Freero reads its headings, bullets and check boxes, with no AI involved, and builds one frame: a summary, decisions as a cluster, action items as task cards with owner and due date, and the rest as notes. One undo removes it.",
      "Agents can do the same over MCP (import_meeting_notes) or the REST API (structure kind meeting).",
    ],
    status: 'built-in',
    connect: {
      steps: [
        "Open a board, then the board menu → Import meeting notes…, or drop a .vtt or .srt file on the board.",
        "Paste or choose the notes, and choose whether to add a speakers note for transcripts.",
      ],
      app: { path: '/app', label: 'Open your boards' },
      docs: { file: 'docs/integrations/README.md', anchor: 'meeting-notes-what-is-read-and-how', label: 'What is read, and how' },
    },
    keywords: ['meeting notes', 'transcript', 'vtt', 'srt', 'granola', 'otter', 'fathom', 'action items', 'decisions'],
    seo: {
      title: 'Meeting notes to whiteboard: decisions and actions',
      description: "Turn meeting notes or a transcript into a whiteboard frame with decisions, action-item cards with owners and due dates, and notes, in one step.",
    },
  },
  {
    id: "n8n",
    name: "n8n",
    category: 'automation',
    oneLiner: "Two importable n8n workflows: new GitHub issue → card, and board comment → Slack.",
    description: [
      "Import a workflow into n8n, add a Freero token and, for webhooks, the signing secret. One workflow turns new GitHub issues into cards on a board; the other checks the webhook signature and forwards board comments to Slack.",
      "This is a recipe on Freero’s public REST API and webhooks, not an app listed in n8n’s own directory.",
    ],
    status: 'api',
    connect: {
      steps: ["Create a Freero token under Connect an agent → Any HTTP client.", "Import a workflow JSON from the recipe into n8n and fill in the credentials."],
      docs: { file: "docs/integrations/n8n.md", label: "n8n recipe" },
    },
    keywords: ["n8n", "workflow", "automation", "self-hosted", "webhooks"],
    seo: {
      title: "n8n and Freero: whiteboard automation workflows",
      description: "Automate your Freero boards with n8n: importable workflows for GitHub issues to cards and board comments to Slack, on the REST API and signed webhooks.",
    },
  },
  {
    id: "make",
    name: "Make",
    category: 'automation',
    oneLiner: "A step-by-step Make scenario on Freero’s REST API and signed webhooks.",
    description: [
      "Build a Make scenario that reacts to Freero webhooks or adds items to a board through the REST API, following the step-by-step guide.",
      "This is a recipe on Freero’s public REST API and webhooks, not an app listed in Make’s own directory.",
    ],
    status: 'api',
    connect: {
      steps: ["Create a Freero token under Connect an agent → Any HTTP client.", "Follow the guide to add the webhook trigger and HTTP modules in Make."],
      docs: { file: "docs/integrations/make.md", label: "Make recipe" },
    },
    keywords: ["make", "integromat", "automation", "scenario", "webhooks"],
    seo: {
      title: "Make and Freero: whiteboard automation scenarios",
      description: "Connect Freero boards to Make scenarios with the REST API and signed webhooks: a step-by-step guide to triggers and actions.",
    },
  },
  {
    id: "zapier",
    name: "Zapier",
    category: 'automation',
    oneLiner: "Zaps that react to Freero webhooks and add items through the REST API.",
    description: [
      "Use Webhooks by Zapier to catch Freero events and the REST API to add notes or cards, following the guide.",
      "This is a recipe on Freero’s public REST API and webhooks, not an app listed in Zapier’s own directory.",
    ],
    status: 'api',
    connect: {
      steps: ["Create a Freero token under Connect an agent → Any HTTP client.", "Follow the guide to set up the Webhooks by Zapier trigger and actions."],
      docs: { file: "docs/integrations/zapier.md", label: "Zapier recipe" },
    },
    keywords: ["zapier", "zap", "automation", "webhooks", "no-code"],
    seo: {
      title: "Zapier and Freero: automate your whiteboards",
      description: "Automate Freero with Zapier: catch board events with Webhooks by Zapier and add notes or cards through Freero’s REST API.",
    },
  },
  {
    id: "power-automate",
    name: "Power Automate",
    category: 'automation',
    oneLiner: "A custom connector for Power Automate and Logic Apps, generated from Freero’s API description.",
    description: [
      "Import the generated Swagger 2.0 connector into Power Automate or Logic Apps and every REST operation becomes an action you can use in a flow.",
      "This is a recipe on Freero’s public REST API and webhooks, not an app listed in Power Automate’s own directory.",
    ],
    status: 'api',
    connect: {
      steps: ["Create a Freero token under Connect an agent → Any HTTP client.", "Import docs/integrations/power-automate/freero.swagger.json as a custom connector and sign in with the token."],
      docs: { file: "docs/integrations/power-automate.md", label: "Power Automate recipe" },
    },
    keywords: ["power automate", "logic apps", "microsoft", "custom connector", "flow"],
    seo: {
      title: "Power Automate connector for Freero whiteboards",
      description: "Use Freero in Power Automate and Logic Apps with a custom connector generated from its REST API: every operation available as an action.",
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Storage (platform/storage, docs/configuration.md "Object storage").

const STORAGE: Integration[] = [
  {
    id: 's3',
    name: 'S3-compatible storage',
    category: 'storage',
    oneLiner: 'A self-hosted Freero keeps uploads in any S3-compatible bucket.',
    description: [
      'Point a self-hosted Freero at Amazon S3 or any S3-compatible service, such as MinIO, Cloudflare R2, Backblaze B2 or DigitalOcean Spaces, and uploaded files and board thumbnails go there instead of the local disk. Boards keep referencing files the same way, so switching never rewrites them.',
      'Server-side encryption (SSE-S3 or SSE-KMS) can be requested for every object, and raster images can be served from a public bucket address or CDN.',
    ],
    status: 'operator',
    connect: {
      steps: ['Set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (and S3_ENDPOINT for a service other than AWS).', 'Restart the server; copy files uploaded before the switch to the bucket.'],
      docs: { file: 'docs/configuration.md', anchor: 'object-storage-uploads-and-board-thumbnails', label: 'Object storage' },
    },
    operatorSetup: 'Set by the server’s operator in its environment.',
    keywords: ['amazon s3', 'aws', 'minio', 'cloudflare r2', 'backblaze', 'object storage', 'self-hosted', 'uploads'],
    seo: {
      title: 'S3-compatible storage for self-hosted Freero',
      description: 'Store a self-hosted Freero’s uploads in Amazon S3, MinIO, Cloudflare R2 or another S3-compatible bucket, with optional server-side encryption.',
    },
  },
];

/** The whole catalog, in the order the app and the site list it (by category, then as written). */
export const INTEGRATIONS: readonly Integration[] = [...AGENTS, ...TRACKERS, ...CHAT, ...EMBEDS, ...CALLS, ...IDENTITY, ...AUTOMATION, ...STORAGE];

export const integrationById = (id: string): Integration | undefined => INTEGRATIONS.find((i) => i.id === id);

/** Where the repository's docs are read (the app and the site both link there). */
export const DOCS_REPO_URL = 'https://github.com/antonber/freero';
export const integrationDocsUrl = (d: IntegrationDocsLink): string => `${DOCS_REPO_URL}/blob/main/${d.file}${d.anchor ? `#${d.anchor}` : ''}`;

/** A team admin console link (`/admin/:workspace…`): the app fills in each team the person administers. */
export const ADMIN_LINK_PREFIX = '/admin/:workspace';
export const isAdminLink = (l: IntegrationAppLink): boolean => l.path.startsWith(ADMIN_LINK_PREFIX);

/** Lower-cased words of a search, matched as prefixes of the entry's words (all must match). */
export function integrationMatches(entry: Pick<Integration, 'name' | 'oneLiner' | 'keywords' | 'category'>, query: string): boolean {
  const terms = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!terms.length) return true;
  const label = INTEGRATION_CATEGORIES.find((c) => c.id === entry.category)?.label ?? '';
  const words = `${entry.name} ${entry.oneLiner} ${entry.keywords.join(' ')} ${label}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return terms.every((t) => words.some((w) => w.startsWith(t)));
}

// ---------------------------------------------------------------------------------------------
// Community listings (#87, server modules/marketplace): integrations people built on Freero's API
// or MCP, shown with a "Community" label once an operator approved them.
//
// GET    /api/marketplace/listings                 -> { listings: CommunityListing[] }   (approved; signed in)
// GET    /api/marketplace/listings/mine            -> { listings: OwnListing[] }         (yours, any status)
// GET    /api/marketplace/listings/:id             -> { listing: CommunityListing | OwnListing } (approved, or yours)
// POST   /api/marketplace/listings  body ListingSubmission -> 201 { listing: OwnListing } (pending; rate-limited)
// DELETE /api/marketplace/listings/:id             -> { ok: true }                       (withdraw yours)
// Operators (modules/moderation; 404 for everyone else):
// GET    /api/moderation/listings?status=pending|approved|rejected|removed -> { listings: ListingForReview[] }
// POST   /api/moderation/actions { action: 'listing.approve' | 'listing.reject' | 'listing.remove' |
//        'listing.restore' | 'listing.feature' | 'listing.unfeature', targetId: <listing id>, … }
// Reports: POST /api/reports { target: { kind: 'listing', id }, reason, note? } (no boardId).

export type ListingStatus = 'pending' | 'approved' | 'rejected' | 'removed';
/** What a community integration is built on. */
export type ListingSurface = 'mcp' | 'api' | 'webhooks';
export const LISTING_SURFACES: ReadonlyArray<{ id: ListingSurface; label: string }> = [
  { id: 'mcp', label: 'MCP server' },
  { id: 'api', label: 'REST API' },
  { id: 'webhooks', label: 'Webhooks' },
];

export const LISTING_LIMITS = { name: 60, tagline: 110, description: 2000, url: 500, email: 254 } as const;
/** Pending and live listings one account may have at once. */
export const MAX_LISTINGS_PER_USER = 10;

export interface ListingSubmission {
  name: string;
  /** One line, like a catalog entry's. */
  tagline: string;
  description: string;
  /** https only. */
  website: string;
  /** https only. */
  docsUrl?: string | null;
  category: IntegrationCategory;
  builtOn: ListingSurface[];
  /** One of the submitter's own registered OAuth apps (Settings → Your OAuth apps). */
  oauthClientId?: string | null;
  /** Where Freero's reviewers reach the developer (never shown to others). */
  contactEmail?: string | null;
}

/** An approved listing as everyone signed in sees it. Every text field is the developer's: render it as text. */
export interface CommunityListing {
  id: string;
  name: string;
  tagline: string;
  description: string;
  website: string;
  docsUrl: string | null;
  category: IntegrationCategory;
  builtOn: ListingSurface[];
  /** It signs people in with an OAuth app registered on this server (its name). */
  oauthApp: { name: string } | null;
  /** An operator highlights it: listed first. */
  featured: boolean;
  createdAt: number;
}

/** A listing as its submitter sees it: any status, and the reviewer's message. */
export interface OwnListing extends CommunityListing {
  status: ListingStatus;
  /** What the operator wrote with the last decision (why it was not approved or removed). */
  statusNote: string;
  contactEmail: string | null;
  decidedAt: number | null;
}

/** What an operator reviews. */
export interface ListingForReview extends Omit<OwnListing, 'oauthApp'> {
  submitter: { id: string; name: string; email: string } | null;
  oauthApp: { clientId: string; name: string; website: string | null; redirectUris: string[] } | null;
  /** Open reports about it. */
  openReports: number;
}

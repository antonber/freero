// Each MCP client's setup for the Connect page, built from this instance's MCP URL. Formats are the
// vendors' documented ones (checked 2026-10-29), never guessed:
//   Claude          support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
//   ChatGPT         developers.openai.com/apps-sdk/deploy/connect-chatgpt
//   Claude Code     code.claude.com/docs/en/mcp
//   Cursor          cursor.com/docs/context/mcp/install-links, cursor.com/docs/context/mcp
//   VS Code         code.visualstudio.com/docs/copilot/guides/mcp-developer-guide ("Create an MCP installation URL")
//   Codex           learn.chatgpt.com/docs/extend/mcp, learn.chatgpt.com/docs/config-file/config-reference
//   Windsurf        docs.devin.ai/desktop/cascade/mcp (Windsurf is Devin Desktop since 2026-06)
//   mcp-remote      github.com/geelen/mcp-remote
// Client names are plain text: no third-party logos (Freero's own brand only).

export type ClientId = 'claude' | 'chatgpt' | 'claude-code' | 'cursor' | 'vscode' | 'other' | 'http';

export const CLIENTS: Array<{ id: ClientId; label: string; intro: string | null }> = [
  { id: 'claude', label: 'Claude', intro: 'Claude on the web and Claude Desktop, as a custom connector. Connectors you add on the web work in Claude Desktop too.' },
  { id: 'chatgpt', label: 'ChatGPT', intro: 'ChatGPT on the web, as a custom MCP server (a plugin). OpenAI decides which plans can add one, and in a workspace an admin may have to allow it first.' },
  { id: 'claude-code', label: 'Claude Code', intro: null },
  { id: 'cursor', label: 'Cursor', intro: null },
  { id: 'vscode', label: 'VS Code', intro: 'VS Code with GitHub Copilot’s agent mode.' },
  { id: 'other', label: 'Other clients', intro: 'Codex, Windsurf and any client that speaks MCP over Streamable HTTP. Each signs in with your Freero account (OAuth) the first time it calls.' },
  { id: 'http', label: 'Any HTTP client', intro: null },
];

/** The tab a link opens (`/settings/connect#cursor`); Claude when it names none we know. */
export function clientFromHash(hash: string): ClientId {
  const id = hash.replace(/^#/, '');
  return CLIENTS.find((c) => c.id === id)?.id ?? 'claude';
}

/** One step: what to do, and maybe something to copy or a link to open. */
export interface SetupBlock {
  text: string;
  copy?: { label: string; value: string };
  link?: { label: string; href: string };
}

const SERVER = 'freero';
const json = (v: unknown) => JSON.stringify(v, null, 2);
/** UTF-8 safe base64 (the URL is ASCII in practice, but nothing here assumes it). */
const base64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

/**
 * Cursor's one-click install: `config` is the server's entry WITHOUT the name wrapper (the name is
 * its own parameter), JSON-stringified then base64-encoded; the base64 is URL-encoded so `+`, `/`
 * and `=` survive the query string.
 */
export const cursorInstallLink = (mcpUrl: string) =>
  `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER}&config=${encodeURIComponent(base64(JSON.stringify({ url: mcpUrl })))}`;

/** VS Code's install URL: `vscode:mcp/install?` + the URL-encoded JSON of the server WITH its name. */
export const vscodeInstallLink = (mcpUrl: string, insiders = false) =>
  `${insiders ? 'vscode-insiders' : 'vscode'}:mcp/install?${encodeURIComponent(JSON.stringify({ name: SERVER, type: 'http', url: mcpUrl }))}`;

export const claudeCodeCommand = (mcpUrl: string, token?: string) =>
  `claude mcp add --transport http ${SERVER} ${mcpUrl}${token ? ` --header "Authorization: Bearer ${token}"` : ''}`;

export function clientSetup(id: Exclude<ClientId, 'http'>, mcpUrl: string): SetupBlock[] {
  switch (id) {
    case 'claude':
      return [
        { text: 'In Claude, open Customize → Connectors (Settings → Connectors in some versions), select + Add, then Add custom connector.' },
        { text: 'Name it Freero, paste this URL, then select Continue and Add.', copy: { label: 'Connector URL', value: mcpUrl } },
        { text: 'Select Connect. Freero’s consent screen opens: sign in, tick what Claude may do (reading and suggesting are on; changing boards and commenting are yours to add) and select Allow.' },
        { text: 'In a chat, turn Freero on in the tools menu, then ask about a board by name or paste a board link.' },
        { text: 'On Team and Enterprise plans, an owner adds the connector first (Organization settings → Connectors → Add → Custom → Web, with the same URL); then each member selects Connect under Customize → Connectors.' },
      ];
    case 'chatgpt':
      return [
        { text: 'In ChatGPT on the web, open Plugins, select the plus button, then Add custom MCP server.', link: { label: 'Open ChatGPT plugins', href: 'https://chatgpt.com/plugins' } },
        { text: 'Name it Freero. Under Connection, for a public endpoint, paste this URL.', copy: { label: 'MCP server URL', value: mcpUrl } },
        { text: 'Set authentication to OAuth, review the risk warning, select I understand and want to continue, then Create as a plugin.' },
        { text: 'Freero’s consent screen opens: sign in, tick what ChatGPT may do and select Allow.' },
        { text: 'In a new chat, type @ and pick Freero, then ask about a board.' },
      ];
    case 'claude-code':
      return [
        { text: 'In a terminal, add Freero to Claude Code (add --scope user to have it in every project):', copy: { label: 'Command', value: claudeCodeCommand(mcpUrl) } },
        { text: 'Start Claude Code, run /mcp, pick freero and choose Authenticate. Your browser opens Freero’s consent screen: tick what it may do and select Allow.' },
        { text: 'Ask it about a board, or use Freero’s prompts as slash commands: /mcp__freero__run_retro, /mcp__freero__summarize_board, /mcp__freero__control_room.' },
        { text: 'On a server or in CI, where no browser can open, make a token under Any HTTP client and add it as a header instead:', copy: { label: 'Command with a token', value: claudeCodeCommand(mcpUrl, 'frp_…') } },
      ];
    case 'cursor':
      return [
        { text: 'Install Freero in Cursor with one click (Cursor opens and asks you to confirm):', link: { label: 'Add Freero to Cursor', href: cursorInstallLink(mcpUrl) } },
        { text: 'Or add it by hand to ~/.cursor/mcp.json (every project) or .cursor/mcp.json (one project):', copy: { label: 'mcp.json', value: json({ mcpServers: { [SERVER]: { url: mcpUrl } } }) } },
        { text: 'Cursor then asks you to sign in to Freero: approve it on Freero’s consent screen. Freero’s tools appear in Cursor’s agent.' },
      ];
    case 'vscode':
      return [
        { text: 'Install Freero in VS Code with one click (VS Code opens and asks you to confirm):', link: { label: 'Add Freero to VS Code', href: vscodeInstallLink(mcpUrl) } },
        { text: 'Using VS Code Insiders?', link: { label: 'Add Freero to VS Code Insiders', href: vscodeInstallLink(mcpUrl, true) } },
        { text: 'Or from a terminal:', copy: { label: 'Command', value: `code --add-mcp '${JSON.stringify({ name: SERVER, type: 'http', url: mcpUrl })}'` } },
        { text: 'Or in .vscode/mcp.json:', copy: { label: 'mcp.json', value: json({ servers: { [SERVER]: { type: 'http', url: mcpUrl } } }) } },
        { text: 'The first time Copilot uses it, VS Code opens your browser to sign in to Freero: approve it on the consent screen.' },
      ];
    case 'other':
      return [
        { text: 'Codex (CLI, IDE extension, desktop): add this to ~/.codex/config.toml, then run codex mcp login freero to sign in.', copy: { label: 'config.toml', value: `[mcp_servers.${SERVER}]\nurl = "${mcpUrl}"` } },
        { text: 'Windsurf (Devin Desktop): in Cascade’s MCP settings, open the raw config and add:', copy: { label: 'mcp_config.json', value: json({ mcpServers: { [SERVER]: { serverUrl: mcpUrl } } }) } },
        { text: 'Most other clients take a remote server as a URL, often in this shape:', copy: { label: 'MCP config', value: json({ mcpServers: { [SERVER]: { url: mcpUrl } } }) } },
        { text: 'A client that only runs local (stdio) servers can reach Freero through the mcp-remote bridge (it needs Node.js and signs in in your browser):', copy: { label: 'Bridge config', value: json({ mcpServers: { [SERVER]: { command: 'npx', args: ['mcp-remote', mcpUrl] } } }) } },
      ];
  }
}

/** The first calls a script makes with a personal token. */
export function curlExamples(apiUrl: string, token: string): Array<{ label: string; value: string }> {
  return [
    { label: 'Who am I', value: `curl ${apiUrl}/me \\\n  -H "Authorization: Bearer ${token}"` },
    { label: 'My boards', value: `curl ${apiUrl}/boards \\\n  -H "Authorization: Bearer ${token}"` },
  ];
}

/**
 * Whether Claude and ChatGPT, which connect from their own servers, can reach this address: https
 * and a public host name (not this computer or a private network).
 */
export function reachableFromTheInternet(mcpUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(mcpUrl);
  } catch {
    return false;
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (u.protocol !== 'https:') return false;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === '::1' || !host.includes('.')) return false;
  return !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host);
}

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
import { t } from './messages';

export type ClientId = 'claude' | 'chatgpt' | 'claude-code' | 'cursor' | 'vscode' | 'other' | 'http';

export const CLIENTS: Array<{ id: ClientId; label: string; intro: string | null }> = [
  { id: 'claude', label: 'Claude', intro: t('claudeOnTheWebAnd') },
  { id: 'chatgpt', label: 'ChatGPT', intro: t('chatgptOnTheWebAs') },
  { id: 'claude-code', label: t('claudeCode'), intro: null },
  { id: 'cursor', label: t('cursor'), intro: null },
  { id: 'vscode', label: t('vsCode'), intro: t('vsCodeWithGithubCopilot') },
  { id: 'other', label: t('otherClients'), intro: t('codexWindsurfAndAnyClient') },
  { id: 'http', label: t('anyHttpClient'), intro: null },
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
        { text: t('inClaudeOpenCustomizeConnectors') },
        { text: t('nameItFreeroPasteThis'), copy: { label: t('connectorUrl'), value: mcpUrl } },
        { text: t('selectConnectFreeroSConsent') },
        { text: t('inAChatTurnFreero') },
        { text: t('onTeamAndEnterprisePlans') },
      ];
    case 'chatgpt':
      return [
        { text: t('inChatgptOnTheWeb'), link: { label: t('openChatgptPlugins'), href: 'https://chatgpt.com/plugins' } },
        { text: t('nameItFreeroUnderConnection'), copy: { label: t('mcpServerUrl'), value: mcpUrl } },
        { text: t('setAuthenticationToOauthReview') },
        { text: t('freeroSConsentScreenOpens') },
        { text: t('inANewChatType') },
      ];
    case 'claude-code':
      return [
        { text: t('inATerminalAddFreero'), copy: { label: t('command'), value: claudeCodeCommand(mcpUrl) } },
        { text: t('startClaudeCodeRunMcp') },
        { text: t('askItAboutABoard') },
        { text: t('onAServerOrIn'), copy: { label: t('commandWithAToken'), value: claudeCodeCommand(mcpUrl, 'frp_…') } },
      ];
    case 'cursor':
      return [
        { text: t('installFreeroInCursorWith'), link: { label: t('addFreeroToCursor'), href: cursorInstallLink(mcpUrl) } },
        { text: t('orAddItByHand'), copy: { label: 'mcp.json', value: json({ mcpServers: { [SERVER]: { url: mcpUrl } } }) } },
        { text: t('cursorThenAsksYouTo') },
      ];
    case 'vscode':
      return [
        { text: t('installFreeroInVsCode'), link: { label: t('addFreeroToVsCode'), href: vscodeInstallLink(mcpUrl) } },
        { text: t('usingVsCodeInsiders'), link: { label: t('addFreeroToVsCode2'), href: vscodeInstallLink(mcpUrl, true) } },
        { text: t('orFromATerminal'), copy: { label: t('command'), value: `code --add-mcp '${JSON.stringify({ name: SERVER, type: 'http', url: mcpUrl })}'` } },
        { text: t('orInVscodeMcpJson'), copy: { label: 'mcp.json', value: json({ servers: { [SERVER]: { type: 'http', url: mcpUrl } } }) } },
        { text: t('theFirstTimeCopilotUses') },
      ];
    case 'other':
      return [
        { text: t('codexCliIdeExtensionDesktop'), copy: { label: 'config.toml', value: `[mcp_servers.${SERVER}]\nurl = "${mcpUrl}"` } },
        { text: t('windsurfDevinDesktopInCascade'), copy: { label: 'mcp_config.json', value: json({ mcpServers: { [SERVER]: { serverUrl: mcpUrl } } }) } },
        { text: t('mostOtherClientsTakeA'), copy: { label: t('mcpConfig'), value: json({ mcpServers: { [SERVER]: { url: mcpUrl } } }) } },
        { text: t('aClientThatOnlyRuns'), copy: { label: t('bridgeConfig'), value: json({ mcpServers: { [SERVER]: { command: 'npx', args: ['mcp-remote', mcpUrl] } } }) } },
      ];
  }
}

/** The first calls a script makes with a personal token. */
export function curlExamples(apiUrl: string, token: string): Array<{ label: string; value: string }> {
  return [
    { label: t('whoAmI'), value: `curl ${apiUrl}/me \\\n  -H "Authorization: Bearer ${token}"` },
    { label: t('myBoards'), value: `curl ${apiUrl}/boards \\\n  -H "Authorization: Bearer ${token}"` },
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

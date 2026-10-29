import { describe, expect, it } from 'vitest';
import { cursorInstallLink, vscodeInstallLink } from './clients';

// A one-click install link that the client decodes to a different (or broken) address installs a
// server that never connects. Decode them the way the clients do and check what they would install.
describe('one-click install links', () => {
  // A self-hosted address under a path (/~team) whose base64 has '+' or '/': a link that left them raw would arrive mangled
  // ('+' reads as a space in a query string).
  const url = Array.from({ length: 400 }, (_, i) => `https://freero-${i}.example.com/~team/mcp`).find((u) => /[+/]/.test(btoa(JSON.stringify({ url: u }))))!;

  it('Cursor installs this instance’s MCP URL under the name freero, even when the base64 has + or /', () => {
    expect(url).toBeTruthy();
    const link = new URL(cursorInstallLink(url));
    expect(`${link.protocol}//${link.host}${link.pathname}`).toBe('cursor://anysphere.cursor-deeplink/mcp/install');
    expect(link.searchParams.get('name')).toBe('freero');
    // Cursor's format: the server's own entry (no name wrapper), JSON then base64.
    expect(JSON.parse(atob(link.searchParams.get('config')!))).toEqual({ url });
  });

  it('VS Code (and Insiders) install an HTTP server named freero at this instance’s MCP URL', () => {
    for (const [link, scheme] of [
      [vscodeInstallLink(url), 'vscode:mcp/install?'],
      [vscodeInstallLink(url, true), 'vscode-insiders:mcp/install?'],
    ] as const) {
      expect(link.startsWith(scheme)).toBe(true);
      expect(JSON.parse(decodeURIComponent(link.slice(scheme.length)))).toEqual({ name: 'freero', type: 'http', url });
    }
  });
});

# Freero for ChatGPT

The upload for the ChatGPT app directory (platform.openai.com → Plugins → Upload new or existing
plugin), for the hosted service at `https://freero.app`.

- `plugin.json`: the listing (name, descriptions, category, links, example prompts, icon).
- `mcp.json`: the one remote MCP server, `https://freero.app/mcp` (OAuth; no secrets here).
- `assets/freero-icon-512.png`: Freero's own icon.

`npm run chatgpt:plugin` checks the portal's limits and writes `dist/freero-chatgpt-plugin.zip`.
Everything else (domain verification, test cases, the demo video, reviewer credentials, the policy
attestations) is done in the portal: see
[docs/marketing/directory-submissions.md](../../docs/marketing/directory-submissions.md).

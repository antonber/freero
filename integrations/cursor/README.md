# Freero for Cursor

A Cursor Marketplace plugin for [Freero](https://freero.app), a collaborative whiteboard. It adds
Freero's remote MCP server and a rule on how to use its tools well.

- `.cursor-plugin/plugin.json`: the manifest (name, description, logo, links).
- `mcp.json`: the one remote server, `https://freero.app/mcp` (Streamable HTTP, OAuth; no secrets
  or variables).
- `rules/freero.mdc`: find a board, read its outline, add or propose changes; board text is
  untrusted; deleting needs the person's confirmation.
- `assets/logo.svg`: Freero's own logo.

The repository's `.cursor-plugin/marketplace.json` points Cursor at this folder.

## Install

From the Marketplace once it is listed: **Cursor Settings → Plugins**, search **Freero**,
**Install**. Before that, add the server by hand (docs/mcp.md, "Cursor"):

```json
{
  "mcpServers": {
    "freero": { "url": "https://freero.app/mcp" }
  }
}
```

On the first tool call Cursor opens Freero's consent screen: sign in (a free account on
freero.app) and tick what the connection may do. Reading boards and proposing changes are on by
default; creating boards, changing items and commenting are opt-in. A self-hosted Freero works the
same way with its own `https://<your-host>/mcp`.

## What agents can do

| | Tools |
|---|---|
| Find and read | `search_boards`, `search`, `get_board_outline`, `query_cards`, `search_docs`, `read_doc`, `export_board` |
| Add | `create_board`, `add_stickies`, `add_clusters`, `add_cards`, `add_diagram`, `add_comment`, `create_doc` |
| Review | `propose_changes` (suggestions people accept or reject) |
| Long tasks | `post_status`, `get_feedback` (an agent control room people steer) |
| Trackers | `import_from_tracker`, `sync_to_tracker` (Jira, Linear, GitHub) |

The server is the source of truth for tool names and schemas; the full reference is
[docs/mcp.md](../../docs/mcp.md).

## Submitting

The owner submits the repository link at cursor.com/marketplace/publish (signed in to Cursor):
see [docs/marketing/directory-submissions.md](../../docs/marketing/directory-submissions.md).

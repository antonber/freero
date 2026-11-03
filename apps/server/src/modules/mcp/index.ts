// Public API of modules/mcp (the remote MCP server, docs/mcp.md): its tools as `tools/list`
// describes them, for packages that must list them ahead of time (modules/teams: the Microsoft 365
// Copilot agent), and the path it answers at.
export { mcpToolDescriptions, type McpToolDescription } from './server';
export { RESOURCE as MCP_PATH } from './routes';

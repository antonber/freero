// Public API of modules/render [S2] (#33): boards drawn as PNG, SVG or PDF on the server, from the
// shared element model — no browser. No table, no routes: the public API and the MCP server call it
// after the export checks (downloads policy, audit) and serve what it draws.
export { renderBoard, renderContentSvg, readRenderSpec, RENDER_FORMATS, RENDER_LIMITS, type RenderFormat, type RenderSpec, type Rendered } from './service';

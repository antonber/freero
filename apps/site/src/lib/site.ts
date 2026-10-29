// Site-wide constants. Pages never hard-code the origin: they use ORIGIN (a placeholder the server
// replaces with PUBLIC_URL when it serves them, modules/site), so one build serves any deployment.

/** Keep in step with apps/server/src/modules/site/site.ts ORIGIN_PLACEHOLDER. */
export const ORIGIN = 'https://origin.freero.invalid';

export const abs = (path: string): string => `${ORIGIN}${path === '/' ? '/' : path}`;

/** The MCP endpoint of this deployment, as shown in setup steps. */
export const MCP_URL = abs('/mcp');

/** Where the source and the docs live. */
export const SOURCE_REPO = 'https://github.com/antonber/freero';
export const docsUrl = (file: string): string => `${SOURCE_REPO}/blob/main/${file}`;

/** App routes the site links to (served by the web app, never by the site). */
export const APP = {
  signup: '/signup',
  login: '/login',
  boards: '/app',
} as const;

export const SITE_NAME = 'Freero';

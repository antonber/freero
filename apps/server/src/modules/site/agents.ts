// The AI agents and answer engines that read the marketing site — model crawlers, AI search
// indexers and the fetchers an assistant sends when a person asks it something — by the name in
// their User-Agent. They get a page as Markdown (served.ts): the same text, without the 50 KB of
// styling and navigation around it.
//
// Search engines (Googlebot, Bingbot, Applebot, DuckDuckBot…) are deliberately NOT here: they get
// the HTML people get, so no search engine ever sees a different page from its visitors.
const AGENTS = [
  // OpenAI: training, ChatGPT search, and fetches for a ChatGPT user.
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  // Anthropic.
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'Claude-Web',
  'anthropic-ai',
  // Perplexity.
  'PerplexityBot',
  'Perplexity-User',
  // Others with an assistant or an answer engine.
  'meta-externalagent',
  'meta-externalfetcher',
  'Amazonbot',
  'MistralAI-User',
  'DuckAssistBot',
  'cohere-ai',
  'YouBot',
  'Bytespider',
  'CCBot',
] as const;

const PATTERN = new RegExp(`(?:^|[^A-Za-z0-9-])(${AGENTS.map((a) => a.replace(/[-]/g, '\\-')).join('|')})(?![A-Za-z0-9-])`, 'i');
const CANONICAL = new Map(AGENTS.map((a) => [a.toLowerCase(), a]));

/** The AI agent a User-Agent names, or null (a browser, a search engine, anything else). */
export function aiAgentOf(userAgent: string | undefined): string | null {
  const m = userAgent ? PATTERN.exec(userAgent) : null;
  return m ? (CANONICAL.get(m[1].toLowerCase()) ?? m[1]) : null;
}

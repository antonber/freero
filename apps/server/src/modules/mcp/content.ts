// How tool results carry board text (agent safety, KAI-170): ALWAYS inside an envelope that says
// it is untrusted data, never mixed into text Freero writes itself. JSON results put it under
// `untrusted_board_content` next to the notice (JSON escaping keeps it inside its string);
// Markdown goes between <untrusted_board_content> tags, and a closing tag written on the board
// can't end the envelope early (it is escaped). Tool names, descriptions, server instructions and
// error messages are Freero's own text and never carry board content.
import type { CallToolResult } from '@modelcontextprotocol/server';
import { UNTRUSTED_CONTENT_NOTICE } from '@freero/shared';

export const ENVELOPE_TAG = 'untrusted_board_content';

/** A result with board content: `facts` (Freero's own words: ids, counts, links) + the content as data. */
export function untrustedJson(content: unknown, facts: Record<string, unknown> = {}): CallToolResult {
  const body = { ...facts, notice: UNTRUSTED_CONTENT_NOTICE, [ENVELOPE_TAG]: content };
  return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body };
}

/** Markdown board content in the tag envelope; a closing tag inside it is neutralised. */
export function wrapMarkdown(markdown: string): string {
  const safe = markdown.replace(new RegExp(`</?\\s*${ENVELOPE_TAG}`, 'gi'), (m) => m.replace('<', '&lt;'));
  return `${UNTRUSTED_CONTENT_NOTICE}\n<${ENVELOPE_TAG}>\n${safe}\n</${ENVELOPE_TAG}>`;
}

export function untrustedMarkdown(markdown: string, facts?: string): CallToolResult {
  return { content: [{ type: 'text', text: (facts ? `${facts}\n\n` : '') + wrapMarkdown(markdown) }] };
}

/** A result in Freero's own words only (no board text). */
export const plain = (text: string, structured?: Record<string, unknown>): CallToolResult => ({
  content: [{ type: 'text', text }],
  ...(structured ? { structuredContent: structured } : {}),
});

/** A refusal or failure the model should read and act on (nothing was changed). */
export const toolError = (text: string): CallToolResult => ({ content: [{ type: 'text', text }], isError: true });

// The languages a code block can be highlighted as, and how a pasted fence names them. Pure.
// The grammars themselves are in ./highlighter.ts, which is only ever loaded with import().

export interface Language {
  /** Grammar id stored on the element. */
  id: string;
  label: string;
  /** Fence tags and file extensions that mean this language. */
  aliases: string[];
}

export const AUTO = 'auto';
export const PLAIN = 'plaintext';

export const LANGUAGES: Language[] = [
  { id: 'typescript', label: 'TypeScript', aliases: ['ts', 'tsx', 'mts', 'cts'] },
  { id: 'javascript', label: 'JavaScript', aliases: ['js', 'jsx', 'mjs', 'cjs', 'node'] },
  { id: 'python', label: 'Python', aliases: ['py', 'python3'] },
  { id: 'java', label: 'Java', aliases: [] },
  { id: 'kotlin', label: 'Kotlin', aliases: ['kt', 'kts'] },
  { id: 'go', label: 'Go', aliases: ['golang'] },
  { id: 'rust', label: 'Rust', aliases: ['rs'] },
  { id: 'c', label: 'C', aliases: ['h'] },
  { id: 'cpp', label: 'C++', aliases: ['c++', 'cc', 'cxx', 'hpp'] },
  { id: 'csharp', label: 'C#', aliases: ['cs', 'c#'] },
  { id: 'swift', label: 'Swift', aliases: [] },
  { id: 'ruby', label: 'Ruby', aliases: ['rb'] },
  { id: 'php', label: 'PHP', aliases: [] },
  { id: 'sql', label: 'SQL', aliases: ['postgres', 'postgresql', 'mysql', 'sqlite'] },
  { id: 'bash', label: 'Shell', aliases: ['sh', 'shell', 'zsh', 'console', 'shellsession'] },
  { id: 'json', label: 'JSON', aliases: ['jsonc', 'json5'] },
  { id: 'yaml', label: 'YAML', aliases: ['yml'] },
  { id: 'xml', label: 'HTML / XML', aliases: ['html', 'xhtml', 'svg', 'xml', 'vue'] },
  { id: 'css', label: 'CSS', aliases: [] },
  { id: 'scss', label: 'SCSS', aliases: ['sass'] },
  { id: 'markdown', label: 'Markdown', aliases: ['md', 'mdx'] },
  { id: 'dockerfile', label: 'Dockerfile', aliases: ['docker'] },
  { id: 'ini', label: 'INI / TOML', aliases: ['toml', 'conf', 'cfg'] },
  { id: 'diff', label: 'Diff', aliases: ['patch'] },
];

const byTag = new Map<string, string>();
for (const l of LANGUAGES) for (const tag of [l.id, ...l.aliases]) byTag.set(tag.toLowerCase(), l.id);

/** The grammar a fence tag (```ts) names; 'auto' for no tag or one we don't know. */
export function languageForTag(tag: string | null | undefined): string {
  const t = tag?.trim().toLowerCase();
  if (!t) return AUTO;
  if (t === 'text' || t === 'txt' || t === PLAIN) return PLAIN;
  return byTag.get(t) ?? AUTO;
}

export function languageLabel(id: string): string {
  if (id === AUTO) return 'Auto-detect';
  if (id === PLAIN) return 'Plain text';
  return LANGUAGES.find((l) => l.id === id)?.label ?? id;
}

/** Stored values we highlight with (anything else from a doc reads as plain text). */
export const isKnownLanguage = (id: string): boolean => id === AUTO || id === PLAIN || LANGUAGES.some((l) => l.id === id);

/**
 * The code of a pasted Markdown fence: the WHOLE paste must be one block (```lang … ```, or ~~~).
 * Its body is kept exactly (tabs, indentation, blank lines); null when it isn't one fence.
 */
export function parseFence(text: string | null): { language: string; code: string } | null {
  if (!text) return null;
  const m = /^[ \t]*(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n]*\r?\n([\s\S]*?)\r?\n?[ \t]*\1[ \t]*$/.exec(text.trim());
  if (!m) return null;
  // Mermaid sources belong to the diagram importer (shape → from-text), not to a code block.
  if (m[2].toLowerCase() === 'mermaid') return null;
  return { language: languageForTag(m[2]), code: m[3].replace(/\r\n/g, '\n') };
}

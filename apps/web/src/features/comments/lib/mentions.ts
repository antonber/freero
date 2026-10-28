// @mentions in comment text. Stored text holds `<@userId>` tokens (see MENTION_RE in
// @freero/shared); the composer shows "@Name" and remembers which names were PICKED from the
// member list — only those become tokens, so typing "@Ann" by hand never mentions anybody.
import { MENTION_RE, mentionToken } from '@freero/shared';

export interface MentionPick {
  id: string;
  name: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Composer text → stored text: every "@Name" of a picked person becomes their token. */
export function encodeMentions(text: string, picks: MentionPick[]): string {
  const byName = new Map<string, string>();
  for (const p of picks) if (p.name) byName.set(p.name, p.id);
  if (!byName.size) return text;
  // Longest names first, so "@Ann Lee" wins over "@Ann"; a name must end at a word boundary.
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(`@(${names.map(escapeRe).join('|')})(?![\\p{L}\\p{N}_])`, 'gu');
  return text.replace(re, (_, name: string) => mentionToken(byName.get(name)!));
}

/** Stored text → composer text ("@Name") and the picks that turn it back into the same tokens. */
export function decodeMentions(text: string, nameOf: (id: string) => string | undefined): { text: string; picks: MentionPick[] } {
  const picks = new Map<string, MentionPick>();
  const out = text.replace(MENTION_RE, (token, id: string) => {
    const name = nameOf(id);
    if (!name) return token; // unknown person: keep the token as it is
    picks.set(id, { id, name });
    return `@${name}`;
  });
  return { text: out, picks: [...picks.values()] };
}

export type Segment = { kind: 'text'; text: string } | { kind: 'mention'; userId: string };

/** Stored text split into plain runs and mentions, for rendering. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    if (m.index! > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    out.push({ kind: 'mention', userId: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

/** `replace` applied to the plain runs only: a find & replace never rewrites inside a mention. */
export function replaceOutsideMentions(text: string, replace: (plain: string) => string): string {
  return segments(text)
    .map((s) => (s.kind === 'text' ? replace(s.text) : mentionToken(s.userId)))
    .join('');
}

/**
 * The "@query" being typed at the caret, if any: an "@" at the start or after a space / opening
 * bracket, up to the caret, on one line, at most two words (names have spaces).
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  // The last "@" that starts a word ("a@b" inside an address doesn't; "@a@b.c" is an address typed after "@").
  let at = before.lastIndexOf('@');
  while (at > 0 && !/[\s([{"'“]/.test(before[at - 1])) at = before.lastIndexOf('@', at - 1);
  if (at < 0) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n\r]/.test(query) || /\s\s/.test(query) || query.split(' ').length > 3) return null;
  return { start: at, query };
}

/** Members matching what was typed after "@": by any word of the name, start-of-word first. */
export function matchMembers<T extends { id: string; name: string }>(members: T[], query: string, limit = 6): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return members.slice(0, limit);
  const scored = members.flatMap((m) => {
    const name = m.name.toLowerCase();
    if (name.startsWith(q)) return [{ m, score: 0 }];
    if (name.split(/\s+/).some((w) => w.startsWith(q))) return [{ m, score: 1 }];
    return [];
  });
  return scored
    .sort((a, b) => a.score - b.score || a.m.name.localeCompare(b.m.name))
    .slice(0, limit)
    .map((s) => s.m);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The query is someone's email address (offer to invite them). */
export const isEmailQuery = (q: string) => EMAIL_RE.test(q.trim());

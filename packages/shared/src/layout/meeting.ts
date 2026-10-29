// Meeting notes → one frame (#88): a summary or transcript exported from a notes app (Granola-,
// Otter-, Fathom- or Meetily-style Markdown or text, WebVTT / SRT captions) read without AI. The
// reader only recognises structure people already wrote — headings, bullets, check boxes, "Owner:"
// and "due" phrases, speaker labels and cue times — and never invents content:
//   - decisions (a "Decisions" section, or lines starting "Decision:") → a cluster of sticky notes;
//   - action items (an "Action items" / "Next steps" section, check boxes, "Action:" lines) → task
//     cards, with an owner (in the card's description) and a due date when the text names them;
//   - every other section's points → sticky notes under that section's title; prose → a written note;
//   - transcripts: who spoke, how often and for how long (an optional "Speakers" note).
// Pure and deterministic like the rest of layout/: the web and the server read a file the same way.
import { cardDraft, ITEM_CARD_W } from './items';
import { frame, textBox, translateDraft } from './kit';
import { layoutClusters, layoutNote } from './structures';
import { LAYOUT_LIMITS, LayoutError, type ElementDraft, type LaidOut, type LayoutContext } from './types';

export type MeetingFormat = 'markdown' | 'text' | 'vtt' | 'srt';

export interface MeetingAction {
  text: string;
  owner?: string;
  /** YYYY-MM-DD */
  dueDate?: string;
  done?: boolean;
}

export interface MeetingSpeaker {
  name: string;
  turns: number;
  /** Seconds they spoke (from cue times), when the transcript has times. */
  seconds: number | null;
  words: number;
}

export interface MeetingNotes {
  title: string;
  /** YYYY-MM-DD, when the notes (or the caller) say. */
  date: string | null;
  attendees: string[];
  /** Prose: the summary paragraphs. */
  summary: string;
  decisions: string[];
  actions: MeetingAction[];
  /** Everything else, by the section it was under. */
  sections: Array<{ title: string; points: string[] }>;
  /** Transcripts only: who spoke. */
  transcript: { speakers: MeetingSpeaker[]; turns: number; seconds: number | null } | null;
}

export interface MeetingOptions {
  format?: MeetingFormat;
  /** Used when the notes have no title of their own (a file name, say). */
  title?: string;
  /** The meeting's date when the notes don't say (YYYY-MM-DD): resolves "by Friday", "Nov 3". */
  date?: string;
}

const clip = (s: string, n: number = LAYOUT_LIMITS.text) => (s.length > n ? s.slice(0, n) : s);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Which reader a file is for: its extension, else its first lines. */
export function meetingFormatOf(fileName: string, head: string): MeetingFormat {
  const n = fileName.toLowerCase();
  if (n.endsWith('.vtt') || /^﻿?WEBVTT\b/.test(head)) return 'vtt';
  if (n.endsWith('.srt') || /^﻿?\s*\d+\s*\r?\n\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(head)) return 'srt';
  if (n.endsWith('.md') || n.endsWith('.markdown') || /^\s*#{1,6}\s/m.test(head)) return 'markdown';
  return 'text';
}

// ---- dates ----------------------------------------------------------------------------------

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const WEEKDAY_RE = '(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';
/** A date phrase this reader understands (used inside larger patterns). */
const DATE_PHRASE = `(?:\\d{4}-\\d{2}-\\d{2}|${MONTH_RE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?(?:,?\\s+\\d{4})?|(?:next\\s+)?${WEEKDAY_RE}|tomorrow|today|end of (?:the )?week|eow|eod)`;

const iso = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
};
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** `s` as YYYY-MM-DD; relative phrases ("Friday", "tomorrow", a date without a year) need `ref`. */
export function readDate(s: string, ref: string | null): string | null {
  const t = s.trim().toLowerCase().replace(/\.$/, '');
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return iso(+m[1], +m[2], +m[3]);
  const refYear = ref ? +ref.slice(0, 4) : null;
  m = new RegExp(`^${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?$`).exec(t);
  if (m) {
    const y = m[3] ? +m[3] : refYear;
    return y ? iso(y, MONTHS[m[1].slice(0, m[1].startsWith('sept') ? 4 : 3)], +m[2]) : null;
  }
  m = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?(?:,?\\s+(\\d{4}))?$`).exec(t);
  if (m) {
    const y = m[3] ? +m[3] : refYear;
    return y ? iso(y, MONTHS[m[2].slice(0, m[2].startsWith('sept') ? 4 : 3)], +m[1]) : null;
  }
  if (!ref) return null;
  if (t === 'today' || t === 'eod') return ref;
  if (t === 'tomorrow') return addDays(ref, 1);
  const day = new Date(`${ref}T00:00:00Z`).getUTCDay();
  if (t === 'eow' || /^end of (the )?week$/.test(t)) return addDays(ref, (5 - day + 7) % 7);
  m = new RegExp(`^(next\\s+)?${WEEKDAY_RE}$`).exec(t);
  if (m) {
    const want = WEEKDAYS.indexOf(m[2].slice(0, 3));
    const ahead = (want - day + 7) % 7 || 7; // the next one after the meeting ("Friday" on a Friday: a week on)
    return addDays(ref, ahead + (m[1] && ahead < 7 ? 7 : 0));
  }
  return null;
}

/** The first date written in a header line ("Thu, Oct 29, 2026 · …", "Date: 2026-10-29"). */
function dateIn(line: string, ref: string | null): string | null {
  const re = new RegExp(`\\d{4}-\\d{2}-\\d{2}|${MONTH_RE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_RE}\\.?(?:,?\\s+\\d{4})?`, 'i');
  const m = re.exec(line);
  return m ? readDate(m[0], ref) : null;
}

// ---- actions --------------------------------------------------------------------------------

const NOT_A_NAME = /^(action|actions|action items?|todo|to-?do|next|next steps?|follow[- ]?ups?|decision|decided|note|notes|owner|due|re|fyi|update|summary|q\d|tbd|we|i|they|team|everyone|all)$/i;
const NAME = "[A-Z][\\p{L}'’.-]*(?:\\s[A-Z][\\p{L}'’.-]*){0,2}";
const looksLikeName = (s: string) => new RegExp(`^${NAME}$`, 'u').test(s) && !NOT_A_NAME.test(s);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One action item's owner and due date, read off its text, and the text without them. */
export function readAction(raw: string, ref: string | null): MeetingAction {
  let text = raw.trim();
  let done = false;
  const box = /^\[( |x|X)\]\s*/.exec(text);
  if (box) {
    done = box[1] !== ' ';
    text = text.slice(box[0].length);
  }
  text = text.replace(/^(?:action(?: item)?|todo|to-do|ai|follow[- ]?up|next step)\s*[:\-–—]\s*/i, '');
  let owner: string | undefined;
  let dueDate: string | undefined;
  // "(Owner: Lena, due Nov 3)", "Owner: Lena", "assigned to @Lena"
  const ownerField = /[([]?\s*\b(?:owner|owners|assignee|assigned to)\s*[:\-–—]?\s*@?([^,;()\]\n]+?)\s*(?:[)\]]|(?=[,;]|$|\s+(?:due|by)\b))/iu.exec(text);
  if (ownerField && ownerField[1].trim()) {
    owner = squash(ownerField[1]);
    text = text.replace(ownerField[0], ' ');
  }
  const due = new RegExp(`[(\\[]?\\s*\\b(?:due(?: date)?|by|before|deadline|until)\\s*[:\\-–—]?\\s*(${DATE_PHRASE})\\b\\s*[)\\]]?`, 'iu').exec(text);
  if (due) {
    const d = readDate(due[1], ref);
    if (d) {
      dueDate = d;
      text = text.replace(due[0], ' ');
    }
  }
  if (!owner) {
    // "@Lena: send the recap", "Lena — send the recap", "[Lena] send …", "**Lena**: …"
    const lead = new RegExp(`^(?:\\*\\*|__)?\\[?@?(${NAME})\\]?(?:\\*\\*|__)?\\s*(?:[:–—]|\\s-\\s|\\])\\s*(.+)$`, 'u').exec(text);
    if (lead && looksLikeName(lead[1])) {
      owner = lead[1];
      text = lead[2];
    } else {
      // "Tom to draft the pricing page", "Priya will check …"
      const verb = new RegExp(`^(${NAME})\\s+(?:to|will|should|needs to|is going to|'ll|’ll)\\s+(.+)$`, 'u').exec(text);
      if (verb && looksLikeName(verb[1])) {
        owner = verb[1];
        text = capitalize(verb[2]);
      } else {
        const at = /(?:^|\s)@([\p{L}][\p{L}0-9_.'-]*)/u.exec(text);
        if (at) owner = at[1];
      }
    }
  }
  text = squash(text.replace(/\(\s*[,;]?\s*\)|\[\s*\]/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/^[,;:\-–—\s]+|[,;:\-–—\s]+$/g, ''));
  return { text: clip(capitalize(text || raw.trim())), ...(owner ? { owner: clip(owner, 120) } : {}), ...(dueDate ? { dueDate } : {}), ...(done ? { done } : {}) };
}

// ---- sections -------------------------------------------------------------------------------

type SectionKind = 'decisions' | 'actions' | 'summary' | 'attendees' | 'transcript' | 'points';

export function sectionKind(title: string): SectionKind {
  const t = title.toLowerCase();
  if (/\b(decision|decisions|decided|agreed|agreements|resolutions?|outcomes?)\b/.test(t)) return 'decisions';
  if (/\b(action|actions|next steps?|to-?dos?|follow[- ]?ups?|tasks?|assignments|owners)\b/.test(t)) return 'actions';
  if (/^(attendees|participants|present|people|in attendance|who was there)\b/.test(t)) return 'attendees';
  if (/\b(transcript|recording)\b/.test(t)) return 'transcript';
  if (/\b(summary|overview|tl;?dr|recap|purpose|context|background|about)\b/.test(t)) return 'summary';
  return 'points';
}

interface Item {
  text: string;
  bullet: boolean;
}

const DECISION_LINE = /^(?:decision|decided|agreed|resolved)\s*[:\-–—]\s*(.+)$/i;
const ACTION_LINE = /^(?:action(?: item)?|todo|to-do|ai|follow[- ]?up|next step)\s*[:\-–—]\s*(.+)$/i;
const BULLET = /^(\s*)(?:[-*+•▪◦‣–]|\d{1,3}[.)])\s+(.*)$/;
const HEADER_FIELD = /^(?:\*\*|__)?(?:date|when|attendees|participants|present|with)(?:\*\*|__)?\s*:(?:\*\*|__)?\s*\S/i;
const stripInline = (s: string) =>
  s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();

/** A heading line of a summary: Markdown (#, setext handled by the caller), a bold line, or a short "Title:" / ALL CAPS line. */
function headingOf(line: string, markdown: boolean): string | null {
  const t = line.trim();
  let m = /^#{1,6}\s+(.+?)\s*#*$/.exec(t);
  if (m) return stripInline(m[1]);
  m = /^(?:\*\*|__)([^*_]{1,80})(?:\*\*|__):?$/.exec(t);
  if (m) return m[1].replace(/:$/, '').trim();
  if (BULLET.test(line)) return null;
  m = /^([\p{L}][\p{L}0-9 &/'’()-]{0,60}):$/u.exec(t);
  if (m && m[1].split(/\s+/).length <= 6) return m[1].trim();
  if (!markdown && /\p{Lu}/u.test(t) && t === t.toUpperCase() && t.length <= 60 && /^[\p{Lu}0-9 &/'’()-]+$/u.test(t) && t.split(/\s+/).length <= 6) return capitalize(t.toLowerCase());
  return null;
}

/** Splits a summary into its title, header lines, and titled sections of items (bullets with their sub-points folded in, paragraphs). */
function sectionsOf(source: string, markdown: boolean) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let title: string | null = null;
  const header: string[] = [];
  const sections: Array<{ title: string; items: Item[] }> = [];
  let current: { title: string; items: Item[] } | null = null;
  let para: string[] = [];
  let lastBullet: Item | null = null;
  let bulletIndent = 0;
  const flush = () => {
    if (!para.length) return;
    const text = stripInline(para.join(' '));
    para = [];
    if (!text) return;
    if (current) current.items.push({ text, bullet: false });
    else header.push(text);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t || /^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flush();
      if (!t) lastBullet = null;
      continue;
    }
    // Setext headings (Title\n=====) in text files and Markdown alike.
    const next = lines[i + 1]?.trim() ?? '';
    const setext = /^(=+|-+)$/.test(next) && next.length >= 3 && !BULLET.test(line);
    const h = setext ? stripInline(t) : headingOf(line, markdown);
    if (h) {
      flush();
      lastBullet = null;
      if (setext) i++;
      // A Markdown or underlined heading before anything else names the meeting (unless it is a
      // section's name, "## Summary").
      if (title === null && !current && !header.length && (/^#{1,6}\s/.test(t) || setext) && sectionKind(h) === 'points') title = h;
      else {
        current = { title: h, items: [] };
        sections.push(current);
      }
      continue;
    }
    const b = BULLET.exec(line);
    if (b) {
      flush();
      const indent = b[1].replace(/\t/g, '  ').length;
      const text = stripInline(b[2]);
      if (!text) continue;
      if (lastBullet && indent > bulletIndent) {
        lastBullet.text += `\n• ${text}`;
        continue;
      }
      const item = { text: b[2].trim().startsWith('[') ? b[2].trim().replace(/^(\[[ xX]\])\s*(.*)$/, (_m, box: string, rest: string) => `${box} ${stripInline(rest)}`) : text, bullet: true };
      bulletIndent = indent;
      lastBullet = item;
      if (current) current.items.push(item);
      else header.push(item.text);
      continue;
    }
    if (lastBullet && /^\s{2,}\S/.test(line)) {
      lastBullet.text += ` ${stripInline(t)}`;
      continue;
    }
    // "Date: …" / "**Attendees:** …" lines stay lines of their own (never run into a paragraph).
    if (HEADER_FIELD.test(t)) {
      flush();
      para.push(t);
      flush();
      continue;
    }
    // A text file's first line (before any section) is its title.
    if (!markdown && title === null && !current && !header.length && !para.length && t.length <= 120 && !/[.!?]$/.test(t) && !/:\s/.test(t)) {
      title = stripInline(t);
      continue;
    }
    para.push(t);
  }
  flush();
  return { title, header, sections };
}

// ---- transcripts ----------------------------------------------------------------------------

interface Turn {
  speaker: string | null;
  start: number | null;
  end: number | null;
  text: string;
}

const seconds = (h: string | undefined, m: string, s: string, ms = '0') => (h ? +h * 3600 : 0) + +m * 60 + +s + +`0.${ms}`;
const CUE_TIME = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

/** "Name: text" (a speaker label a captioner or a person typed), else null. */
function labelled(text: string): { speaker: string; text: string } | null {
  const m = /^(?:-\s*)?(?:\[([^\]]{1,60})\]|([\p{L}][\p{L}0-9 .'’-]{0,40}?))\s*:\s+(.+)$/u.exec(text);
  if (!m) return null;
  const speaker = (m[1] ?? m[2]).trim();
  if (!speaker || speaker.split(/\s+/).length > 4 || /^(https?|note|warning)$/i.test(speaker)) return null;
  return { speaker, text: m[3] };
}

/** Cues of a WebVTT (W3C WebVTT: `<v Name>` voice spans, NOTE / STYLE / REGION blocks) or SRT file. */
function cuesOf(source: string, format: 'vtt' | 'srt'): Turn[] {
  const blocks = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const out: Turn[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim());
    const at = lines.findIndex((l) => CUE_TIME.test(l));
    if (at < 0) continue;
    if (format === 'vtt' && /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const t = CUE_TIME.exec(lines[at])!;
    const payload = lines.slice(at + 1).join('\n');
    const voice = /<v(?:\.[^\s>]+)*\s+([^>]+)>/.exec(payload);
    let text = squash(payload.replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}>/g, ' ').replace(/<\/?[^>]+>/g, '')).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
    let speaker = voice ? squash(voice[1]) : null;
    if (!speaker) {
      const l = labelled(text);
      if (l) {
        speaker = l.speaker;
        text = l.text;
      }
    }
    if (!text) continue;
    out.push({ speaker, start: seconds(t[1], t[2], t[3], t[4]), end: seconds(t[5], t[6], t[7], t[8]), text });
  }
  return out;
}

/** "Priya Raman  0:03" or "Priya Raman (00:01:12)" speaker lines (Otter-style text exports), each followed by what they said. */
const SPEAKER_LINE = /^([\p{L}][\p{L}0-9 .'’-]{0,50}?)\s*(?:\s{2,}|\s*[([]\s*|\s+)((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[)\]]?$/u;
function stampedTurns(source: string): Turn[] | null {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: Turn[] = [];
  let cur: Turn | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const m = SPEAKER_LINE.exec(line);
    if (m) {
      const parts = m[2].split(':').map(Number);
      const start = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
      if (cur) cur.end = start;
      cur = { speaker: m[1].trim(), start, end: null, text: '' };
      out.push(cur);
    } else if (cur && line) cur.text = `${cur.text} ${line}`.trim();
  }
  return out.filter((t) => t.text).length >= 3 ? out.filter((t) => t.text) : null;
}

/** "Name: what they said" lines (a transcript pasted as text, or a notes file's Transcript section). */
function labelledTurns(lines: string[]): Turn[] {
  const out: Turn[] = [];
  for (const raw of lines) {
    const line = raw.trim().replace(/^\[?\(?\d{1,2}:\d{2}(?::\d{2})?\)?\]?\s*/, '');
    const l = labelled(line);
    if (l) out.push({ speaker: l.speaker, start: null, end: null, text: l.text });
    else if (out.length && line) out[out.length - 1].text += ` ${line}`;
  }
  return out;
}

/** Who spoke: consecutive cues of one speaker are one turn; talk time from cue times. */
function speakersOf(cues: Turn[]): NonNullable<MeetingNotes['transcript']> {
  const timed = cues.every((c) => c.start !== null && c.end !== null);
  const turns: Array<{ speaker: string; words: number; spoken: number }> = [];
  for (const c of cues) {
    const speaker = c.speaker ?? 'Unnamed speaker';
    const words = c.text.split(/\s+/).filter(Boolean).length;
    const spoken = timed ? Math.max(0, c.end! - c.start!) : 0;
    const last = turns[turns.length - 1];
    if (last && c.speaker && last.speaker === speaker) {
      last.words += words;
      last.spoken += spoken;
    } else turns.push({ speaker, words, spoken });
  }
  const by = new Map<string, MeetingSpeaker>();
  for (const t of turns) {
    const s = by.get(t.speaker) ?? { name: t.speaker, turns: 0, seconds: timed ? 0 : null, words: 0 };
    s.turns++;
    s.words += t.words;
    if (s.seconds !== null) s.seconds += t.spoken;
    by.set(t.speaker, s);
  }
  const span = timed && cues.length ? Math.max(...cues.map((c) => c.end!)) - Math.min(...cues.map((c) => c.start!)) : null;
  return {
    speakers: [...by.values()].map((s) => ({ ...s, seconds: s.seconds === null ? null : Math.round(s.seconds) })).sort((a, b) => (b.seconds ?? b.words) - (a.seconds ?? a.words)),
    turns: turns.length,
    seconds: span === null ? null : Math.round(span),
  };
}

// ---- the reader ------------------------------------------------------------------------------

/** Reads meeting notes or a transcript. Throws a LayoutError when there is nothing to read. */
export function parseMeetingNotes(source: string, opts: MeetingOptions = {}): MeetingNotes {
  if (typeof source !== 'string' || !source.trim()) throw new LayoutError('The meeting notes are empty');
  if (source.length > LAYOUT_LIMITS.meeting) throw new LayoutError(`Meeting notes can be at most ${LAYOUT_LIMITS.meeting} characters`);
  if (opts.date !== undefined && (typeof opts.date !== 'string' || !readDate(opts.date, null))) throw new LayoutError('date must be YYYY-MM-DD');
  const format = opts.format ?? meetingFormatOf('', source.slice(0, 2000));
  if (!['markdown', 'text', 'vtt', 'srt'].includes(format)) throw new LayoutError('format must be markdown, text, vtt or srt');
  const fallbackTitle = squash(opts.title ?? '') || null;
  const notes: MeetingNotes = { title: '', date: opts.date ?? null, attendees: [], summary: '', decisions: [], actions: [], sections: [], transcript: null };
  const ref = () => notes.date;
  // An item goes where its section says; elsewhere "Decision: …" / "Action: …" lines and check
  // boxes still say what they are.
  const take = (text: string, kind: 'decisions' | 'actions' | 'points', section: { title: string; points: string[] } | null) => {
    const decision = DECISION_LINE.exec(text);
    if (kind === 'decisions' || (kind === 'points' && decision)) notes.decisions.push(clip(capitalize(decision ? decision[1] : text)));
    else if (kind === 'actions' || ACTION_LINE.test(text) || /^\[[ xX]\]/.test(text)) notes.actions.push(readAction(text, ref()));
    else section?.points.push(clip(text));
  };

  if (format === 'vtt' || format === 'srt') {
    const cues = cuesOf(source, format);
    if (!cues.length) throw new LayoutError(`No captions found in this ${format === 'vtt' ? 'WebVTT' : 'SRT'} file`);
    notes.title = fallbackTitle ?? 'Meeting transcript';
    // A WebVTT comment may say when it was recorded ("NOTE Design review, 2026-10-28").
    const note = /^﻿?WEBVTT[^\n]*\n+NOTE\s+([^\n]+)/.exec(source.replace(/\r\n?/g, '\n'));
    notes.date = (note ? dateIn(note[1], notes.date) : null) ?? notes.date;
    notes.transcript = speakersOf(cues);
    for (const c of cues) for (const s of c.text.split(/(?<=[.!?])\s+/)) if (DECISION_LINE.test(s) || ACTION_LINE.test(s)) take(s, 'points', null);
    return notes;
  }

  // A text file that is a transcript (Otter-style stamped speaker lines, or mostly "Name: text").
  if (format === 'text') {
    const stamped = stampedTurns(source);
    const lines = source.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
    const labelledLines = stamped ? null : labelledTurns(lines);
    const isTranscript = stamped ?? (labelledLines && labelledLines.length >= 4 && new Set(labelledLines.map((t) => t.speaker)).size >= 2 && labelledLines.length >= lines.length * 0.6 ? labelledLines : null);
    if (isTranscript) {
      const first = lines[0]?.trim() ?? '';
      notes.title = (first && !SPEAKER_LINE.test(first) && !labelled(first) ? clip(first, 200) : null) ?? fallbackTitle ?? 'Meeting transcript';
      notes.date = dateIn(first, notes.date) ?? notes.date;
      notes.transcript = speakersOf(isTranscript);
      for (const t of isTranscript) for (const s of t.text.split(/(?<=[.!?])\s+/)) if (DECISION_LINE.test(s) || ACTION_LINE.test(s)) take(s, 'points', null);
      return notes;
    }
  }

  const { title, header, sections } = sectionsOf(source, format === 'markdown');
  notes.title = clip(title ?? fallbackTitle ?? 'Meeting notes', 200);
  // The notes' own date wins over the caller's ("Weekly sync — 2026-10-27").
  notes.date = (title ? dateIn(title, notes.date) : null) ?? notes.date;
  const summary: string[] = [];
  // Header lines: "Date: …", "Attendees: …", "Thu, Oct 29, 2026 · Priya, Tom", or prose.
  for (const h of header) {
    const labelledHeader = /^(date|when|attendees|participants|present|people|with)\s*:\s*(.+)$/i.exec(h);
    if (labelledHeader) {
      if (/^(date|when)$/i.test(labelledHeader[1])) notes.date = dateIn(labelledHeader[2], notes.date) ?? notes.date;
      else notes.attendees.push(...labelledHeader[2].split(/\s*[,;]\s*|\s+and\s+/).map(squash).filter(Boolean));
      continue;
    }
    const parts = h.split(/\s+[·•|]\s+/);
    const dated = parts.map((p) => dateIn(p, notes.date));
    if (parts.length > 1 && dated.some(Boolean)) {
      notes.date = dated.find(Boolean) ?? notes.date;
      parts.forEach((p, i) => {
        if (dated[i]) return;
        const names = p.split(/\s*,\s*|\s+and\s+/).map(squash);
        if (names.every((n) => looksLikeName(n))) notes.attendees.push(...names);
      });
      continue;
    }
    if (dateIn(h, notes.date) && h.length <= 40) {
      notes.date = dateIn(h, notes.date);
      continue;
    }
    const d = DECISION_LINE.exec(h);
    const a = ACTION_LINE.exec(h);
    if (d || a || /^\[[ xX]\]/.test(h)) take(h, 'points', null);
    else summary.push(h);
  }
  for (const s of sections) {
    const kind = sectionKind(s.title);
    if (kind === 'attendees') {
      for (const it of s.items) notes.attendees.push(...it.text.split(/\s*[,;]\s*|\n•\s*/).map(squash).filter(Boolean));
      continue;
    }
    if (kind === 'transcript') {
      const turns = labelledTurns(s.items.map((i) => i.text));
      if (turns.length) notes.transcript = speakersOf(turns);
      continue;
    }
    if (kind === 'summary') {
      const points = { title: s.title, points: [] as string[] };
      for (const it of s.items) {
        if (it.bullet) take(it.text, 'points', points);
        else summary.push(it.text);
      }
      if (points.points.length) notes.sections.push(points);
      continue;
    }
    const section = { title: clip(s.title, 200), points: [] as string[] };
    for (const it of s.items) take(it.text, kind === 'points' ? 'points' : kind, section);
    if (section.points.length) notes.sections.push(section);
  }
  notes.summary = summary.join('\n\n');
  notes.attendees = [...new Set(notes.attendees)].slice(0, 100);
  return notes;
}

// ---- the frame -------------------------------------------------------------------------------

const PAD = 64;
const GAP = 120;
const CARD_GAP = 12;

const duration = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);

/** The "Speakers" note: who spoke, how many turns, for how long (or how many words). */
export function speakersText(t: NonNullable<MeetingNotes['transcript']>): string {
  const total = t.speakers.reduce((n, s) => n + (s.seconds ?? s.words), 0) || 1;
  const head = `${t.speakers.length} speaker${t.speakers.length === 1 ? '' : 's'} · ${t.turns} turn${t.turns === 1 ? '' : 's'}${t.seconds !== null ? ` · ${duration(t.seconds)}` : ''}`;
  const lines = t.speakers.map((s) => {
    const share = Math.round(((s.seconds ?? s.words) / total) * 100);
    return `• ${s.name}: ${s.turns} turn${s.turns === 1 ? '' : 's'} · ${s.seconds !== null ? duration(s.seconds) : `${s.words} words`} (${share}%)`;
  });
  return [head, '', ...lines].join('\n');
}

const longDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${day}, ${y}`;
};

interface Block {
  laid: LaidOut;
  /** Which new elements are which input items (LaidOut.parts). */
  parts?: NonNullable<LaidOut['parts']>;
}

/** One frame holding the meeting: notes on top, then decisions, action items and the other sections. */
export function layoutMeeting(notes: MeetingNotes, opts: { speakers?: boolean }, ctx: LayoutContext): LaidOut {
  const frameId = ctx.newId();
  const top: Block[] = [];
  const row: Block[] = [];
  const intro = [notes.date ? longDate(notes.date) : '', notes.attendees.length ? `With ${notes.attendees.join(', ')}` : ''].filter(Boolean).join('\n');
  if (intro || notes.summary) top.push({ laid: layoutNote('Summary', [intro, notes.summary].filter(Boolean).join('\n\n'), ctx) });
  if (notes.transcript && opts.speakers !== false) top.push({ laid: layoutNote('Speakers', speakersText(notes.transcript), ctx) });
  if (notes.decisions.length) {
    const laid = layoutClusters([{ title: 'Decisions', color: 'green', items: notes.decisions }], ctx);
    row.push({ laid, parts: laid.parts });
  }
  if (notes.actions.length) {
    const titleEl = textBox(ctx.newId(), 0, 0, ITEM_CARD_W, 'Action items', { size: 24, bold: true });
    let y = titleEl.h + 16;
    const cards = notes.actions.map((a) => {
      const description = [a.owner ? `Owner: ${a.owner}` : ''].filter(Boolean).join('\n');
      const card = cardDraft({ text: a.text, description, dueDate: a.dueDate ?? null, status: a.done ? 'done' : 'todo' }, ctx.newId(), 0, y, ITEM_CARD_W, null);
      y += card.h + CARD_GAP;
      return card as ElementDraft;
    });
    row.push({ laid: { elements: [titleEl, ...cards], content: {}, moves: [], size: { w: ITEM_CARD_W, h: y - CARD_GAP } }, parts: [{ titleId: titleEl.id, ids: cards.map((c) => c.id) }] });
  }
  if (notes.sections.length) {
    const laid = layoutClusters(
      notes.sections.map((s) => ({ title: s.title, color: 'yellow' as const, items: s.points })),
      ctx,
    );
    row.push({ laid, parts: laid.parts });
  }
  const placed = [...top, ...row].filter((b) => b.laid.elements.length);
  if (!placed.length) throw new LayoutError('Nothing in these notes to put on the board: no summary, decisions, action items, points or speakers were found');
  const elements: ElementDraft[] = [];
  const put = (blocks: Block[], y: number) => {
    let x = PAD;
    let h = 0;
    for (const b of blocks) {
      if (!b.laid.elements.length) continue;
      for (const el of b.laid.elements) elements.push({ ...translateDraft(el, x, y), frameId } as ElementDraft);
      x += b.laid.size.w + GAP;
      h = Math.max(h, b.laid.size.h);
    }
    return { w: x - GAP + PAD, h };
  };
  const a = put(top, PAD);
  const b = put(row, PAD + (a.h ? a.h + GAP / 2 : 0));
  const w = Math.max(a.w, b.w, 480);
  const h = PAD + (a.h ? a.h + GAP / 2 : 0) + b.h + PAD;
  const box = frame(frameId, { x: 0, y: 0, w, h }, clip(notes.title, 200));
  if (elements.length + 1 > LAYOUT_LIMITS.elements) throw new LayoutError(`At most ${LAYOUT_LIMITS.elements} items per structure`);
  const parts = row.flatMap((r) => r.parts ?? []);
  return { elements: [box, ...elements], content: {}, moves: [], size: { w, h }, parts: [{ titleId: frameId, ids: top.flatMap((t) => t.laid.elements.map((e) => e.id)) }, ...parts] };
}

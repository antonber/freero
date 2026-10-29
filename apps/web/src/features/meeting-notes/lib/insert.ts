// Meeting notes on the board (#88): the file (or pasted text) is read and laid out by @freero/shared's
// `layoutStructure({ kind: 'meeting' })` — the very layout the server runs for the API / MCP — and
// created in ONE transaction (one undo step) on a free spot, as one frame.
import { nanoid } from 'nanoid';
import { layoutStructure, LayoutError, meetingFormatOf, translateDraft, type LaidOut } from '@freero/shared';
import type { Editor, NewElement, Point } from '@engine';

export const DIALOG = 'meeting-notes.dialog';
/** What the file picker offers. */
export const ACCEPT = '.md,.markdown,.txt,.vtt,.srt';
/** Caption files: nothing else on the board claims them, so a drop imports them directly. */
export const TRANSCRIPT_FILE = /\.(vtt|srt)$/i;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** A file name as a title when the notes have none: "design-review.vtt" → "Design review". */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : '';
}

/** Today in the person's own time zone, as YYYY-MM-DD (the meeting's date when the notes don't say). */
export function localDate(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export interface MeetingInput {
  text: string;
  /** The file it came from (its format and fallback title). */
  fileName?: string;
  /** Include who spoke (transcripts). Default true. */
  speakers?: boolean;
  /** YYYY-MM-DD; default today. */
  date?: string;
}

/** Lays the notes out from (0, 0). Throws a LayoutError (a message for the person). */
export function layoutMeetingNotes(input: MeetingInput): LaidOut {
  const name = input.fileName ?? '';
  return layoutStructure(
    {
      kind: 'meeting',
      source: input.text,
      format: meetingFormatOf(name, input.text.slice(0, 2000)),
      ...(name ? { title: titleFromFileName(name) } : {}),
      date: input.date ?? localDate(),
      speakers: input.speakers !== false,
    },
    { newId: nanoid },
  );
}

export interface MeetingReport {
  frameId: string;
  title: string;
  decisions: number;
  actions: number;
  notes: number;
}

/** Creates the laid-out frame near `at` (default: the middle of the view), selected and in view. */
export function placeMeeting(editor: Editor, laid: LaidOut, at?: Point): MeetingReport {
  if (!editor.mayAdd('frame')) throw new LayoutError('You can’t add items to this board right now.');
  const spot = editor.findFreeSpot(laid.size, at ? { near: at } : undefined);
  const placed = laid.elements.map((d) => translateDraft(d, spot.x, spot.y));
  let ids: string[] = [];
  editor.transact(() => {
    ids = editor.createMany(placed as unknown as NewElement[]);
  });
  const frame = placed[0];
  if (!ids.length || frame.type !== 'frame') throw new LayoutError('You can’t add items to this board right now.');
  editor.select([ids[0]]);
  editor.zoomToFit([ids[0]], { animate: true, padding: 96, maxZoom: Math.max(1, editor.getCamera().zoom) });
  // The layout's colours say what is what: decisions are green notes, other points yellow ones.
  return {
    frameId: ids[0],
    title: frame.title,
    decisions: placed.filter((d) => d.type === 'sticky' && d.color === 'green').length,
    actions: placed.filter((d) => d.type === 'card').length,
    notes: placed.filter((d) => (d.type === 'sticky' && d.color !== 'green') || d.type === 'shape').length,
  };
}

/** One line for a toast. */
export function summary(r: MeetingReport): string {
  const parts = [
    r.decisions ? `${r.decisions} decision${r.decisions === 1 ? '' : 's'}` : '',
    r.actions ? `${r.actions} action item${r.actions === 1 ? '' : 's'}` : '',
    r.notes ? `${r.notes} note${r.notes === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return `Imported “${r.title}”${parts.length ? `: ${parts.join(', ')}` : ''}`;
}

/** Reads a file and places it; throws LayoutError (a message for the person). */
export async function importMeetingFile(editor: Editor, file: File, opts: { speakers?: boolean } = {}, at?: Point): Promise<MeetingReport> {
  if (file.size > MAX_FILE_BYTES) throw new LayoutError(`That file is over ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  return placeMeeting(editor, layoutMeetingNotes({ text: await file.text(), fileName: file.name, speakers: opts.speakers }), at);
}

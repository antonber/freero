// Smart drawing (#3): what happens to a finished pen stroke the recogniser read as something.
// The ink is always created first, by the stroke's own gesture; the clean version replaces it in a
// step of its own (Editor.afterGesture), so Undo once brings the ink back and twice removes it.
import { nanoid } from 'nanoid';
import type { BoardElement } from '@freero/shared';
import type { Editor, Rect } from '@engine';
import type { Recognition } from './recognise';

import { t } from '../messages';
/** How much of an item's box a scratch-out must cover to erase it. */
const SCRATCH_COVER = 0.5;

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Items a scratch-out over `area` erases: ones it mostly covers that may be changed. */
export function scratchedOut(editor: Editor, area: Rect, inkId: string): BoardElement[] {
  return editor.elementsInRect(area, 'intersect').filter((el) => {
    if (el.id === inkId || el.locked || editor.getDefinition(el.type)?.container || !editor.mayEdit([el.id])) return false;
    const box = editor.getBounds([el.id]);
    if (!box) return false;
    return overlap(box, area) >= SCRATCH_COVER * Math.max(box.w * box.h, 1);
  });
}

export interface InkStyle {
  color: string;
  width: number;
}

/**
 * Replaces the ink `inkId` with what it was read as: a shape (through `shape.insert`), a line or
 * arrow (`connector.insert`), or — a scratch-out — nothing, erasing what it covers. Leaves the ink
 * alone when that can't be made (the owning feature isn't there) or a scratch-out covers nothing.
 */
export function applyRecognition(editor: Editor, inkId: string, reading: Recognition, ink: InkStyle): void {
  if (!editor.getElement(inkId)) return;
  if (reading.type === 'scribble') {
    const gone = scratchedOut(editor, reading, inkId);
    if (!gone.length) return;
    editor.remove([inkId, ...gone.map((el) => el.id)]);
    editor.host.notify(t('scratchedOutLengthItems', { length: gone.length }), 'info', {
      action: { label: t('undo'), run: () => editor.undo() },
    });
    return;
  }
  const id = nanoid();
  editor.transact(() => {
    if (reading.type === 'shape') {
      const { shape: kind, x, y, w, h, rotation } = reading;
      editor.runCommand('shape.insert', { id, kind, x, y, w, h, rotation, stroke: ink.color, strokeWidth: ink.width, fill: 'transparent' });
    } else {
      editor.runCommand('connector.insert', {
        id,
        from: reading.from,
        to: reading.to,
        endCap: reading.arrow ? 'arrow' : 'none',
        stroke: ink.color,
        strokeWidth: ink.width,
      });
    }
    if (editor.getElement(id)) editor.remove([inkId]);
  });
}

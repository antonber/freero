import { LibraryBig } from 'lucide-react';
import type { ShapeKind } from '@freero/shared';
import { defineCommands } from '@engine';
import { armShape, shapeInRect } from './lib/actions';
import { LIBRARY_PANEL_ID, SHAPE_KINDS } from './lib/constants';
import { LIBRARY_KINDS } from './lib/library';

import { t } from './messages';
const KINDS = new Set<string>([...SHAPE_KINDS.map((s) => s.kind), ...LIBRARY_KINDS]);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// Quick keys: jump straight to a specific shape (the Shapes tool remembers it afterwards).
export default defineCommands([
  {
    id: 'shape.rectangle',
    label: t('rectangle'),
    shortcut: 'r',
    run: (editor) => armShape(editor, 'rect'),
  },
  {
    id: 'shape.ellipse',
    label: t('circle'),
    shortcut: 'o',
    run: (editor) => armShape(editor, 'ellipse'),
  },
  {
    id: 'shape.openLibrary',
    label: t('shapeLibrary'),
    icon: LibraryBig,
    menus: ['board'],
    minRole: 'viewer',
    run: (editor) => editor.openDock(LIBRARY_PANEL_ID),
  },
  {
    // [#3] A shape of `kind` in a box, made by another feature (smart drawing turns an inked
    // rectangle into one). Styled like the next shape the Shapes tool would draw, with the
    // border / fill given. Args: { kind, x, y, w, h, id?, rotation?, stroke?, strokeWidth?, fill? }.
    id: 'shape.insert',
    label: t('insertShape'),
    palette: false,
    run: (editor, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      if (typeof a.kind !== 'string' || !KINDS.has(a.kind) || ![a.x, a.y, a.w, a.h].every(num)) return;
      const el = shapeInRect(editor, a.kind as ShapeKind, { x: a.x as number, y: a.y as number, w: a.w as number, h: a.h as number });
      editor.create({
        ...el,
        ...(typeof a.id === 'string' ? { id: a.id } : {}),
        ...(num(a.rotation) ? { rotation: a.rotation } : {}),
        ...(typeof a.stroke === 'string' ? { stroke: a.stroke } : {}),
        ...(num(a.strokeWidth) && a.strokeWidth > 0 ? { strokeWidth: a.strokeWidth } : {}),
        ...(typeof a.fill === 'string' ? { fill: a.fill, fillOpacity: a.fill === 'transparent' ? 0 : 1 } : {}),
      });
    },
  },
]);

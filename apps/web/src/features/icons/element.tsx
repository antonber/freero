import { memo } from 'react';
import type { IconElement } from '@freero/shared';
import { defineElement, type ElementRenderProps, type NewElement } from '@engine';
import { IconSvg } from './lib/nodes';
import { DEFAULT_COLOR, DEFAULT_STROKE, ICON_SIZE, insertIcon, parseDragPayload } from './lib/insert';
import './icons.css';

/** Vector, so it stays crisp at any zoom; the drawing lives in the element (see IconElement). */
const IconView = memo(function IconView({ element }: ElementRenderProps<IconElement>) {
  return <IconSvg className="fr-icons-el" nodes={element.nodes} color={element.color} strokeWidth={element.strokeWidth} />;
});

export default defineElement({
  type: 'icon',
  resize: 'aspect',
  minSize: { w: 12, h: 12 },
  defaults: (): Omit<NewElement<'icon'>, 'x' | 'y'> => ({
    type: 'icon',
    w: ICON_SIZE,
    h: ICON_SIZE,
    name: '',
    nodes: [],
    color: DEFAULT_COLOR,
    strokeWidth: DEFAULT_STROKE,
  }),
  Component: IconView,
  toPlainText: (el) => el.name.replace(/-/g, ' '),
  // Icons dragged out of the library arrive as marked text; claim only those (above table / link
  // / sticky / text importers, below image files).
  importPriority: 40,
  importData(editor, data, at) {
    const icon = parseDragPayload(data.text);
    if (!icon) return false;
    insertIcon(editor, icon, at);
    return true;
  },
});

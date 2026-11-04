import { Shapes as ShapesIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { looksLikeMermaid, looksLikePlantUml, type ShapeElement } from '@freero/shared';
import { canvasInk, defineElement, ElementText, richTextToPlain, type ElementRenderProps, type NewElement } from '@engine';
import { anchorOnOutline, classDividers, ENTITY_FONT, ENTITY_LINE, ENTITY_PAD, entityDivider, hitShape, insetPaths, outlineToward, textBox } from './lib/geometry';
import { DEFAULT_SIZE } from './lib/constants';
import { shapeDefaults } from './lib/actions';
import { decodeDrag, insertShape } from './lib/insert';
import { t } from './messages';
import './shape.css';

/** Below this zoom text is unreadable: skip laying it out (big boards stay fast). */
const LOD_ZOOM = 0.12;

function dashArray(style: ShapeElement['strokeStyle'], sw: number): string | undefined {
  if (style === 'dashed') return `${Math.max(6, sw * 3)} ${Math.max(4, sw * 2)}`;
  if (style === 'dotted') return `0 ${Math.max(4, sw * 2)}`;
  return undefined;
}

const ShapeView = memo(function ShapeView({ element, zoom }: ElementRenderProps<ShapeElement>) {
  const { shape, w, h, fill, fillOpacity, stroke, strokeStyle } = element;
  const sw = Math.max(0, element.strokeWidth);
  // A class with compartments is a table like an entity: its whole box holds the text.
  const classTable = shape === 'umlClass' && !!element.compartments;
  const paths = useMemo(() => insetPaths(classTable ? 'rect' : shape, w, h, sw), [classTable, shape, w, h, sw]);
  const tb = useMemo(() => (classTable ? { x: 0, y: 0, w, h } : textBox(shape, w, h)), [classTable, shape, w, h]);
  // ElementText sizes 'auto' text from the element box: hand it the text area instead.
  const textEl = useMemo(() => ({ ...element, w: tb.w, h: tb.h }), [element, tb]);
  const entity = shape === 'erdEntity' || classTable;
  const pad = entity ? ENTITY_PAD + sw / 2 : Math.max(4, Math.min(tb.w, tb.h) * 0.07) + sw / 2;
  const transparent = fill === 'transparent';
  // Unfilled, the outline and text lie on the canvas: their default ink turns light on a dark page
  // (painted through `color` + currentColor; the doc keeps the authored colour).
  // A mark without text filled with the default ink (a state diagram's start dot, a fork bar) is
  // ink too: it would vanish on a dark page.
  const inkMark = !transparent && !element.text && canvasInk(fill) !== fill;
  const ink = transparent || inkMark ? canvasInk(stroke) : stroke;
  const textInk = transparent ? canvasInk(element.textColor) : undefined;
  // An entity is a table: title line, a divider, then one attribute per line. A class adds a
  // divider above its operations.
  const plain = classTable ? richTextToPlain(element.text) : '';
  const dividers = useMemo(
    () => (classTable ? classDividers(plain, element.fontSize, sw) : entity ? [entityDivider(element.fontSize, sw)] : []),
    [classTable, entity, plain, element.fontSize, sw],
  );
  return (
    <div className="fr-shape">
      <svg className="fr-shape__svg" width={w} height={h} aria-hidden style={{ color: ink }}>
        <path
          d={paths.outline}
          fill={transparent ? 'none' : fill}
          style={inkMark ? { fill: canvasInk(fill) } : undefined}
          fillOpacity={fillOpacity}
          stroke={sw > 0 ? 'currentColor' : 'none'}
          strokeWidth={sw}
          strokeDasharray={dashArray(strokeStyle, sw)}
          strokeLinejoin="round"
          strokeLinecap={strokeStyle === 'dotted' ? 'round' : 'butt'}
        />
        {paths.dashed && sw > 0 && (
          <path d={paths.dashed} fill="none" stroke="currentColor" strokeWidth={sw} strokeDasharray={`${Math.max(6, sw * 3)} ${Math.max(5, sw * 2.5)}`} />
        )}
        {sw > 0 &&
          dividers.filter((y) => y < h - sw).map((y, i) => <path key={i} d={`M${sw / 2} ${y}H${w - sw / 2}`} stroke="currentColor" strokeWidth={sw} />)}
        {paths.details && sw > 0 && (
          <path
            d={paths.details}
            fill="none"
            stroke="currentColor"
            strokeWidth={sw}
            strokeDasharray={dashArray(strokeStyle, sw)}
            strokeLinecap={strokeStyle === 'dotted' ? 'round' : 'butt'}
          />
        )}
      </svg>
      {zoom >= LOD_ZOOM && (
        <div className="fr-shape__text" style={{ left: tb.x, top: tb.y, width: tb.w, height: tb.h }}>
          {entity ? (
            <ElementText
              element={textEl}
              field="text"
              padding={pad}
              placeholder=""
              fontSize={element.fontSize === 'auto' ? ENTITY_FONT : element.fontSize}
              style={{ lineHeight: ENTITY_LINE }}
              color={textInk}
            />
          ) : (
            <ElementText element={textEl} field="text" padding={pad} placeholder="" color={textInk} />
          )}
        </div>
      )}
    </div>
  );
});

export default defineElement({
  type: 'shape',
  label: { one: t('shape'), many: t('shapes') },
  icon: ShapesIcon,
  resize: 'free',
  minSize: { w: 8, h: 8 },
  sharedStyle: (el) => ({
    fill: el.fill,
    stroke: el.stroke,
    strokeWidth: el.strokeWidth,
    strokeStyle: el.strokeStyle,
    fontFamily: el.fontFamily,
    fontSize: el.fontSize,
    textColor: el.textColor,
    align: el.align,
    vAlign: el.vAlign,
  }),
  // A fill picked for a see-through shape shows (like the shape's own fill control).
  applySharedStyle: (el, style) => ({ ...style, ...(style.fill && style.fill !== 'transparent' && el.fillOpacity === 0 ? { fillOpacity: 1 } : {}) }),
  textField: 'text',
  defaults: (): Omit<NewElement<'shape'>, 'x' | 'y'> => ({
    ...shapeDefaults('rect'),
    w: DEFAULT_SIZE,
    h: DEFAULT_SIZE,
  }),
  Component: ShapeView,
  toPlainText: (el) => richTextToPlain(el.text),
  // Unfilled outlines are thin targets: half the stroke plus the engine's screen tolerance.
  hitTest(el, local, { tolerance }) {
    return hitShape(el.shape, el.w, el.h, local, {
      filled: el.fill !== 'transparent' && el.fillOpacity > 0.02,
      tolerance: el.strokeWidth / 2 + tolerance,
      hasText: !!el.text && !!richTextToPlain(el.text).trim(),
    });
  },
  anchorPoint: (el, anchor) => anchorOnOutline(el.shape, el.w, el.h, anchor),
  outlinePoint: (el, toward) => outlineToward(el.shape, el.w, el.h, toward),
  // A tile dragged out of the shape library lands where it is dropped.
  importPriority: 40,
  importData(editor, data, at) {
    if (data.files.length) return false;
    // Pasted Mermaid or PlantUML (diagrams as code) becomes shapes and connectors: the from-text feature lays
    // it out, keeps its source for later edits, and reports unreadable lines.
    if (looksLikeMermaid(data.text) || looksLikePlantUml(data.text)) {
      editor.runCommand('from-text.insert', { kind: looksLikeMermaid(data.text) ? 'mermaid' : 'plantuml', text: data.text, at });
      return true;
    }
    const s = decodeDrag(data.text);
    if (!s) return false;
    insertShape(editor, s, at);
    return true;
  },
});

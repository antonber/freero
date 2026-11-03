// A diagram (#117; docs/design/diagrams.md): a container whose members it keeps laid out live. The
// element draws its frame — a title band with the layout and layers, and the body its members sit
// on —; its `arrange` is the one writer of the members' layout (@freero/shared planDiagram), and its
// `hidesMember` folds away what a hidden layer holds (#118).
import { memo } from 'react';
import { Focus, Layers, Workflow } from 'lucide-react';
import { DIAGRAM_LAYOUT, DIAGRAM_LAYOUT_NAMES, diagramLayers, hiddenByLayer, planDiagram, type DiagramElement } from '@freero/shared';
import { defineElement, ElementText, richTextToPlain, sanitizeRichText, useEditor, useFocus, type ElementRenderProps, type NewElement } from '@engine';
import { activeLayer, addStep, focusDiagram } from './lib/actions';
import './diagram.css';

const TITLE_PART = 'title';
/** What the layout moved in each arrange pass (rounds of one pass share `previous`): never a move by hand. */
const movedInPass = new WeakMap<object, Set<string>>();
/** Below this zoom text is unreadable: draw only the frame. */
const LOD_ZOOM = 0.15;

const DiagramView = memo(function DiagramView({ element: d, selected, zoom }: ElementRenderProps<DiagramElement>) {
  const editor = useEditor();
  const focused = useFocus() === d.id;
  const layers = diagramLayers(d);
  const hidden = layers.filter((l) => l.hidden).length;
  const lod = zoom < LOD_ZOOM;
  const { headerH } = DIAGRAM_LAYOUT;
  return (
    <div className={`fr-diagram${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}`}>
      <div className="fr-diagram__head" style={{ height: headerH }}>
        {!lod && (
          <>
            <Workflow className="fr-diagram__icon" size={16} aria-hidden />
            <div className="fr-diagram__title">
              <ElementText
                element={d}
                part={TITLE_PART}
                value={d.title}
                onCommit={(html) => editor.update<DiagramElement>(d.id, { title: sanitizeRichText(html) })}
                fontSize={16}
                fontFamily="sans"
                align="left"
                vAlign="middle"
                color="var(--fr-canvas-ink, #17162b)"
                padding={{ top: 0, right: 8, bottom: 0, left: 4 }}
                style={{ fontWeight: 650 }}
                placeholder="Diagram"
              />
            </div>
            <span className="fr-diagram__chip">{DIAGRAM_LAYOUT_NAMES[d.layout] ?? 'Manual'}</span>
            {layers.length > 1 && (
              <span className="fr-diagram__chip" title={hidden ? `${hidden} hidden` : undefined}>
                <Layers size={12} aria-hidden />
                {layers.length}
                {hidden ? ` · ${hidden} hidden` : ''}
              </span>
            )}
            {!focused && (
              <button
                type="button"
                className="fr-diagram__focus"
                data-fr-interactive=""
                aria-label={`Focus on ${richTextToPlain(d.title) || 'this diagram'}`}
                title="Focus on this diagram (Esc to leave)"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => focusDiagram(editor, d.id)}
              >
                <Focus size={14} aria-hidden />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
});

export default defineElement({
  type: 'diagram',
  label: { one: 'Diagram', many: 'Diagrams' },
  icon: Workflow,
  // The box hugs the members: no handles (the layout and the members decide its size).
  resize: 'none',
  rotatable: false,
  container: true,
  minSize: { w: DIAGRAM_LAYOUT.minW, h: DIAGRAM_LAYOUT.minH },
  defaults: (): Omit<NewElement<'diagram'>, 'x' | 'y'> => ({ type: 'diagram', w: DIAGRAM_LAYOUT.minW, h: DIAGRAM_LAYOUT.minH, title: 'Diagram', layout: 'down' }),
  Component: DiagramView,
  swatch: () => null,
  toPlainText: (d) => [d.title, ...diagramLayers(d).map((l) => l.name)].map((t, i) => (i === 0 ? richTextToPlain(t) : t)).filter(Boolean).join('\n'),
  // The title band edits the title; a double-click on the body adds a step there.
  textPartAt: (d, local) => (local.y <= DIAGRAM_LAYOUT.headerH ? TITLE_PART : null),
  textParts: (d) => [{ part: TITLE_PART, html: d.title }],
  writeTextPart(d, part, html, editor) {
    if (part === TITLE_PART) editor.update<DiagramElement>(d.id, { title: sanitizeRichText(html) });
  },
  onDoubleClick(d, { editor, point }) {
    if (d.locked) return;
    addStep(editor, d, point);
  },
  // The live layout, membership upkeep, pins, layer locks and stacking, and the box (see the doc).
  arrange(d, { editor, previous }) {
    let moved = movedInPass.get(previous);
    if (!moved) movedInPass.set(previous, (moved = new Set()));
    const patches = planDiagram(d, editor.getElements(), { previous, joinLayer: activeLayer(editor, d), moved });
    return patches.length ? (patches as never) : null;
  },
  // A hidden layer folds its items away for everyone (and the lines touching them).
  hidesMember(d, member, { editor }) {
    if (!d.layers?.some((l) => l.hidden)) return false;
    return hiddenByLayer(d, member, { get: (id) => editor.getElement(id) });
  },
});

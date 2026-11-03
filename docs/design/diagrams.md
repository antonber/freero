# Diagram containers and diagram layers (#117, #118)

Status: **built** (see "As built" at the end). Modelled on the kanban (docs/design/kanban-fields-and-views.md):
the container element is the collection, its members point at it, one writer keeps membership and
layout, and everything personal stays out of the doc.

## What we want

A diagram is one object on the board. Its shapes and connectors live inside it, it re-arranges
itself when a step is added, removed, resized or connected, and it opens in a focus mode that dims
and locks the rest of the board. Mermaid, PlantUML, the AI and agents (MCP) all make one. Inside a
diagram, named layers (network, services, data flows) can be shown, hidden and locked to tell
different stories.

Freero before this: shapes and connectors on the open canvas; auto-layout a one-shot command
(`features/arrange`); "Insert from text" drawing loose shapes (`features/from-text`); the
`swimlane` and `kanban` containers showing the container pattern.

## Model

### 1. A diagram is a container element; its members are its children

```
DiagramElement (type 'diagram', new)
  title:    RichText
  layout:   'down' | 'right' | 'up' | 'left' | 'tree' | 'orgchart' | 'manual'
  layers?:  DiagramLayer[]       // bottom to top; absent = one layer, "Layer 1" (id DEFAULT_LAYER)
  laidOut?: string               // the structure last laid out (diagramSignature): see 3.

DiagramLayer { id, name, hidden?: true, locked?: true }

BaseElement (additive, members only)
  diagramPinned?: true           // a person moved it: the live layout keeps it where it was put
  diagramLayer?:  string         // its layer (absent / unknown: DEFAULT_LAYER, else the bottom one)
  layerLocked?:   true           // its `locked` was set by its layer's lock (cleared with it)
```

**Membership is containment**, as for frames and kanbans: an item whose `frameId` is the diagram
is a member. So moving, copying, duplicating, deleting, hiding in a hidden frame, version restore,
templates, the outline, search and export all carry the members along with no new code. A Mermaid
subgraph is a frame member; what is inside it travels with it. Connectors joining two members are
members too (the diagram adopts them, see 2), so a copied diagram keeps its lines.

**Units and edges.** The layout works on *units*: the diagram's direct members other than
connectors (a frame member is one unit with its contents). An *edge* is a connector attached at both
ends to two different units (or to anything inside them).

### 2. One writer: the diagram's `arrange`

`features/diagram`'s element `arrange` is the only writer of members' positions, `diagramPinned`,
`diagramLayer` on join, `layerLocked` / their layer locks, member `z`, connector membership and the
diagram's own box and `laidOut`. It runs after every local change (engine contract), and the
server runs the same plan (`@freero/shared` `planDiagram` / `withDiagramLayout`) for changes it
makes (MCP, REST, AI), so a board laid out by either reads the same. The diagram feature's commands
write the diagram's own fields (layout, layers) and members' layers / pins.

Per pass the plan does, in order:

1. **Membership upkeep.** A member that joined in this change (created inside, dropped in) loses any
   old pin and goes to the person's active layer (personal, see 6). One that left loses its pin,
   layer and layer lock. A connector whose both ends are inside the diagram but is not a member
   becomes one.
2. **Pins.** A member this change moved by hand — its position changed, its size did not, and it
   was not carried by the diagram's or a frame member's own move — is pinned (auto layouts only).
3. **Reflow**, only when the structure changed (3.).
4. **Layer locks and stacking** (5.).
5. **Fit.** The diagram's box hugs its members (with a header band and padding, never smaller than
   its minimum); it has no resize handles.

### 3. When the layout reflows and when it respects manual moves

The diagram stores `laidOut`, a signature of the structure it last laid out: the layout mode, every
unit's id and size, every edge's pair of units. A pass reflows **only when the signature differs**:

| Change | Reflows? |
|---|---|
| A node added (created inside, dropped in, pasted in, added by an agent) | yes |
| A node removed (deleted, dragged out) | yes |
| A node resized (or its text grew it) | yes |
| A connector added, removed or re-attached between two units | yes |
| The layout mode changed | yes |
| A node moved by hand | **no** — it is pinned instead |
| Text edited, colour, style, a layer hidden / shown / locked, a layer reordered | no |
| The whole diagram moved | no |

A reflow lays out every unit with the mode's algorithm — `layered` (down / right; up / left are
mirrored) or `tidyTree` (tree: left to right; org chart: top-down), the same layouts layout-from-structure
and Auto-layout use — in a stable order (creation time, then id), so every client and the server
compute the same positions from the same board. Then:

- **Pinned and locked units stay where they are** but keep their place in the graph (ranks and
  order), so pinning one never moves the others.
- Free units that would overlap a pinned or locked one are pushed along the cross axis past it.
- The drawing keeps the top-left of the free units that were already laid out (new ones don't
  drag it), else the diagram's content origin.
- Connectors between two free units take the flow's sides (out the far side, in the near one;
  loops back along the flank) and drop hand-made bends.

**Manual** mode never moves anything; the box still grows to fit. "Lay out again" (format bar,
context menu) clears every pin and reflows; "Let the layout place it" unpins the selected members.
A diagram that was just created (inserted from text, pasted, duplicated, from a template, by an
agent) adopts the drawing it arrives with: its signature is recorded without a reflow, so a Mermaid
diagram keeps the look its own layout gave it until its structure changes.

**Undo**: a reflow happens in the transaction of the change that caused it (engine `arrange`), so the
add / resize / layout change and its reflow are one undo step. Remote changes are never undone.

### 4. Concurrency

Elements are last-writer-wins per element. Two people adding a step at the same moment each reflow
their own replica (different new elements, the old members rewritten by both). The merge can leave
the two new steps on one spot. The engine's existing conflict pass (`editor/arrange.ts`): a client
that laid out a container in the last 5 s re-plans it on the merged board; the signature now names
both new steps, so it is out of layout, and the highest client id among the writers reflows once.
Every client then finds it laid out (idempotent: no ping-pong). Bystanders never re-plan.

A pin is written on the moved member itself (with its move, one write), never on the diagram, so
two people pinning different steps never lose one. Layers are on the diagram element: two people
renaming two layers at once keep one rename (as kanban columns).

### 5. Layers (#118)

- **Belonging**: each member has one layer (`diagramLayer`); a frame member's contents follow
  their frame. New members join the person's active layer.
- **Hide** (`layers[i].hidden`, shared, editors): members of a hidden layer are folded away for
  everyone — not drawn, hit-tested, selected or exported (`ElementDefinition.hidesMember`, which
  exports already honour) — and so is a connector touching one. Nothing is deleted: the outline,
  search and the API still list them, and showing the layer brings them back in place (hidden
  members keep their slot in the layout, so hiding never reflows).
- **Lock** (`layers[i].locked`): enforced like item locks — the plan writes `locked` (with the
  `layerLocked` marker) on the layer's members, so they can't be moved, edited or deleted by anyone
  until the layer is unlocked; unlocking clears only the locks the layer set, so an item someone
  locked on its own stays locked. Old clients see ordinary locks.
- **Order**: the members' stacking follows the layers bottom to top; a member brought to front goes
  to the top of its own layer.
- **Copy** keeps layers: they are on the diagram element, members keep their layer ids, and layer
  ids are local to their diagram.

The engine's `isFolded` now also folds an item whose container is itself folded, so a hidden
layer's frame hides what is in it.

### 6. Focus mode (personal)

"Focus" (format bar, the diagram's header, the command palette) zooms to the diagram and puts the
engine in focus on it for this viewer only: everything outside it is drawn faded and is inert (not
hit-tested, selected, marquee'd or Tab-walked). Esc (after the selection is cleared) or the bar's
"Exit focus" ends it. It is engine UI state (`Editor.setFocus`), never in the doc, any role. A
viewer can focus too. The person's active layer is a personal view setting
(`Editor.setPersonalView(diagramId, '_layer')`, kept through `Host.personalViews`).

### 7. Creating diagrams

- **Insert ▸ Diagram** (the "+" tools, the board menu): an empty diagram on a free spot; double-click
  inside it to add a step (a shape that joins and is laid out).
- **Make a diagram** from a selection (context menu): wraps the selected items (and the lines
  between them) in a diagram, keeping their drawing (manual until a layout is picked).
- **From text and agents**: `@freero/shared` `layoutStructure` wraps graph-like structures in a
  diagram (`wrapInDiagram`): Mermaid flowcharts, class, ER and state diagrams and PlantUML class /
  activity / state / use case / component diagrams by their direction; trees and org charts as
  tree / org chart; sequence diagrams as manual. Mind maps stay mind maps. So Insert from text, a
  pasted or dropped `.mmd` / `.puml`, the in-app AI and MCP `add_diagram` all make one, and "Edit
  diagram source" finds the container again by its key.
- **Into a diagram**: MCP `add_diagram` with `into: <diagramId>` (the REST structure endpoint's
  `placement.into`) adds the new steps to that diagram; its layout makes room.

### 8. Agents and the API

- Outline: a diagram reads as `diagram` with its title, layout and layers; its layers are sections
  (when there are two or more), hidden / locked marked, and its members are listed in them.
- REST items carry `type: 'diagram'` and the members' `frameId`; MCP `add_diagram` returns the
  diagram's id first.

### 9. Ownership (Dune)

| Durable value | Single writer | Others |
|---|---|---|
| `DiagramElement` (title, layout, layers, laidOut, box) | `features/diagram` (element `arrange`, commands); server: `modules/structure` / `modules/api` through `withDiagramLayout` | `runCommand('diagram.*')` |
| Members' positions, `diagramPinned`, `diagramLayer`, `layerLocked` (+ their `locked`), member `z` | `features/diagram`'s `arrange` (the layout); its commands for pins / layers | moving a member pins it (the layout writes the pin) |
| Focus | engine UI state (`Editor.setFocus`) | — |
| Active layer | personal view (`Host.personalViews`) | — |

Pure logic in `@freero/shared` `layout/diagram.ts`: members, units, edges, the signature, the plan,
`withDiagramLayout`, `wrapInDiagram`, layer lookup.

### 10. Rollout (mixed old and new clients)

- Old clients don't know `diagram`: they draw an "Unsupported item" box under the members and the
  members as ordinary shapes and connectors (all of it editable). An old client that moves a member
  takes it out of the diagram (their membership rule doesn't know the container); nothing is lost
  and the next new client's pass reflows the rest. Locked layers read as ordinary locks; hidden
  layers are **visible** to old clients (they don't know `hidesMember` for diagrams) — the hide is a
  presentation, not access control, and is documented as such.
- Old servers don't exist in a single deploy; the server and web ship together.
- No migration: no existing board has diagrams. Mermaid inserted before this release stays loose
  shapes; "Make a diagram" wraps them.

## Tests (the failures that matter)

- Two people adding a step at once both keep their steps and nothing overlaps after the reflow, fixed
  by one client, no ping-pong.
- A step moved by hand stays where it was put when the diagram later reflows, and nothing lands on it.
- Hiding a layer hides its members (and the lines touching them) for everyone and from exports, but
  deletes nothing; showing it brings them back in place.
- Locking a layer stops its members moving; unlocking it leaves an item locked on its own locked.
- Undo of a change that reflowed (a new step, a layout switch) takes the change and the reflow back
  in one step.
- A diagram inserted from Mermaid keeps its drawn layout until its structure changes.
- Out of focus is inert: a click outside the focused diagram selects nothing; Esc ends focus.
- The server adds steps into a diagram laid out without overlaps.

## As built (2026-11-03)

- Shared: `packages/shared/src/layout/diagram.ts` (`planDiagram`, `withDiagramLayout`, `wrapInDiagram`,
  `diagramSignature`, `diagramLayers`, `memberLayerId`, `hiddenByLayer`); `layoutStructure` wraps.
  The engine's arrange runs up to three rounds per pass with the same `previous`; the plan is told
  which members its own layout already moved (`moved`), so a reflow is never mistaken for a hand move.
- Engine: `Editor.setFocus` / `getFocus` / `useFocus`, `getInteractiveElements` (hit tests, marquee,
  lasso, selection, Tab walk), Esc after the selection; `isFolded` follows folded containers.
- Feature `features/diagram`: element (title band with layout and layers chips and a focus button,
  `arrange`, `hidesMember`, double-click adds a step), tool ("+" ▸ Diagram), commands (Insert diagram,
  Make a diagram, Focus, Leave focus, Lay out again, Let the layout place it, Diagram layers…,
  `diagram.setLayout`), format bar (layout picker, Lay out again, Layers, Focus), panels (layers dock,
  focus bar), outline.
- From text: containers' members keep their places on a source edit; "Re-lay out diagram" is offered
  only for diagrams from before containers (and brings them into one).
- Server: `realtime` knows the type; `modules/structure` (`placement.into` a diagram) and
  `modules/api` (update and delete items) lay diagrams out in the same change; MCP `add_diagram`
  `into`.

Known limits:
- The box hugs its members: a step dragged until its centre leaves the box leaves the diagram (the
  container rule frames and kanbans follow), and a diagram that grows can come to overlap items
  beside it (they are not taken in).
- Old clients see hidden layers' items (see Rollout).
- Lines from outside the diagram to a hidden step stay drawn.

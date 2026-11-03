# Kanban phases 2 and 3: fields, group-by and views of the same data

Status: **steps 2a–2f, 3a, 3b and 3e built** (schema foundation, card display, group by and
swimlanes, filter and sort, agents and API, fields from trackers / templates / CSV; view tabs, the
Table tab and focus mode; List, Calendar and Timeline tabs; table ↔ kanban conversion; see the "as
built" sections below); the rest of phase 3 proposed. The
owner's decisions on the open questions are under "Decisions". Phase 1 (card colour follows column,
smoother drag, keyboard moves, column reorder / collapse / resize) has landed.

## What we want

People should be able to change how a kanban's data is presented, the way database tools let them
re-slice one set of records: group the cards by any field, add a second grouping as swimlanes, pick
which fields a card shows, filter and sort, and look at the same cards as a table, a list, a
calendar or a timeline. Changing one view changes the data everywhere. Agents must be able to do all
of it through MCP and REST.

Freero is a whiteboard first. Cards that people can drag anywhere, connect, comment on, vote on and
send to a tracker are what makes a board different from a database. **This design keeps cards as
first-class board items and treats every other presentation as a projection of them.**

## What exists today

| Piece | Where | How it works |
|---|---|---|
| Task card | `features/card`, `CardElement` | title, description, accent `color`, `status` (todo / doing / done), `assigneeId`, `dueDate`, `startDate`, `estimate`, `tags`, item `link`. Written by the card feature. Other features write through `card.setDates` and `card.setEstimate`. |
| Kanban | `features/kanban`, `KanbanElement` | A container: its `columns[]` (title, optional `status`, `wip`, colour) live on the element. A card belongs to the column under its center (`frameId` = kanban). `arrange` (`lib/layout.ts planLayout`) stacks children. A card dropped into a status column takes that status, and a card whose status changed in place moves to that column. |
| Table | `features/table` | Typed columns (text, number, date, select, person, checkbox). Cells are stored one key per cell in `tableCells`. Sort, one filter, and `view: 'board'` drawing rows as cards grouped by a select column. Rows are not board items (#51 / KAI-245). |
| Timeline | `features/timeline` | A container that hosts bars and task cards by their dates (`@freero/shared timelineLayout`). The server re-lays it when a tracker moves dates. |
| Tags | `features/tags` | A board-wide vocabulary (`tags` collection). Items carry tag ids. |
| Server | `modules/structure` (placement into a column), `modules/api` (`updateItems`), `modules/mcp` (`add_cards`, `update_items`, `get_board_outline`), `modules/trackers` (status ↔ column through `KANBAN_LAYOUT`) | Server writes go through realtime's `changeBoard` (`BoardChange`: create / update / remove elements, set collection entries). |

Facts that constrain the design:

- **Elements are whole JSON values in one `Y.Map`** (`BoardStore.writeElement` sets the merged
  object). Concurrent edits to *different fields of the same element* are last-writer-wins on the
  whole element. Different elements never collide.
- **`frameId` is single.** A card is hosted by at most one container, so it cannot be a real canvas
  item in two kanbans, or in a kanban and a timeline, at the same time.
- Every container that lays out its children does it in `arrange`, deterministically and only for
  local changes. Server writers re-lay in the same change (trackers do this for timelines).
- Features never import each other. They share types and pure logic through `@freero/shared`,
  primitives through `@ui`, and framework hooks through `@engine`.

## How other tools frame it (concepts only)

From public help pages (sources at the end). We describe the concepts, not their UI or wording:

- A **database** holds records with typed properties. A **view** is a saved presentation of it: a
  layout (board, table, list, calendar, timeline), filter, sort and grouping. Each view keeps its own
  settings.
- **Board views group by one field.** Dragging a card to another group sets that field. Tools limit
  board grouping to single-value fields such as single select, person and status. A second level of
  grouping appears as **rows / swimlanes**, and dropping into a cell sets both values.
- **Display properties are separate from filters**: one decides what a card shows, the other which
  cards appear.
- **Shared vs personal settings**: a filter or sort can apply to everyone or only to me. Views can be
  **locked** against configuration changes.
- **Manual order vs sort**: manual order is shared, and while a sort applies you can't reorder by
  hand.
- **Linked views** show another place's data without copying it. Permissions follow the source.

## The proposed model

### 1. A collection is a kanban element. Its cards are its children.

The `kanban` element becomes the **collection**. It carries the schema (field definitions with
options) and its views. **Membership is containment**: the collection's records are the card
elements whose `frameId` is the kanban. That is today's rule, so:

- Dropping a card in **joins** the collection. The column (group) it lands in sets its group value,
  and the other fields start empty.
- Dragging a card out **leaves** the collection. It keeps its built-in fields. Its custom values
  stay on the card dormant, keyed by field id, so dragging it back restores them.
- A card outside any kanban is a plain task card with built-in fields only. Cards don't need a
  collection to exist.

Why containment rather than an explicit `collectionId`: it is already how kanbans behave, and it
needs no new "where is this card?" states. Every consumer that reads kanbans today (outline,
placement, tracker import, templates, copy / paste / duplicate, layers, version restore) already
follows `frameId`. Duplicating a kanban duplicates the collection and its cards with no id remapping
beyond what `insertElements` does now. The alternative, where a card stays a member wherever it is
dragged (Notion-like), is open question 1.

### 2. The schema lives on the kanban element

```
KanbanElement (additive fields)
  fields?:     FieldDef[]        // custom fields, in display order
  views?:      ViewConfig[]      // the element's view tabs (≥ 1 once migrated)
  activeView?: string            // which tab the element shows (shared)
  columns:     KanbanColumn[]    // kept as a derived cache for older clients and the server (see Migration)
```

```ts
type FieldType = 'select' | 'multiselect' | 'person' | 'date' | 'number' | 'text' | 'url' | 'checkbox';

interface FieldDef {
  id: string;                 // stable; values are keyed by it
  name: string;               // unique in the collection (case-insensitive), ≤ 60 chars
  type: FieldType;
  options?: FieldOption[];    // select / multiselect, in order (≤ 200)
  number?: { format: 'plain' | 'percent' | 'currency'; currency?: string; decimals?: number };
}

interface FieldOption {
  id: string;
  label: string;
  color: string;              // from the Freero option palette (ui/tokens.css)
  status?: CardStatus | null; // this option sets the card's built-in status (today's "Sets card status")
}
```

**Built-in fields** are the card's own fields, given fixed ids so views treat them like any other
field: `$title`, `$status`, `$assignee` (person), `$due`, `$start` (date), `$estimate` (number),
`$tags` (multiselect over the board's tag vocabulary), `$link` (url), `$created`, `$updated`. They
stay where they are on the card, so trackers, notifications (`realtime/cards.ts`), the timeline and
planning poker keep working unchanged.

**Values** go on the card:

```
CardElement (additive)
  values?: Record<fieldId, FieldValue>
```

Canonical encodings live in `@freero/shared/fields`. They are the one implementation the web, the
server, CSV and the outline all use:

| Type | Stored | Notes |
|---|---|---|
| select | option id | Ids, not labels (tables store labels), so renaming an option is one write. Readers show the label. |
| multiselect | option id[] | ordered as the options are |
| person | user id | resolved through the people directory. Gone people read "Deleted user". |
| date | `YYYY-MM-DD` | local calendar date, as `dueDate` |
| number | number | finite. Format is display-only. |
| text | plain string ≤ 2000 | not RichText: values are data, and plain text is safer to render in many places |
| url | string | shown only through `isSafeHref` |
| checkbox | `true` | absent = unchecked |

Why on the card and not in a per-key collection like `tableCells`:

- **Everything that handles elements handles values for free**: undo, copy / paste / duplicate,
  board layers (hidden frames, private drafts), version restore, backups, suggestions (a value change
  is an element patch, so `propose_changes` and stale detection work), the API's `ApiItem.data`, and
  server `BoardChange.update`.
- **A drag and the value it sets are one write.** Moving a card to "Doing" writes its position and
  its Stage value in one element update, so no client ever sees the card in one column with another
  column's value.
- **The cost** is per-element last-writer-wins: two people changing *different* fields of the
  *same* card within the same sync window keep only one of the changes. That is already true for
  status, assignee and due date. Typing into many cells at once, which is why tables went per-key,
  isn't how cards are edited. If this bites, the fix is an engine-level per-field merge for elements,
  which would help every element type. It is not a kanban-only workaround. See Risks.

Why the schema is on the element and not in a board-level `collections` map: same reasoning. Kanban
columns and table columns already live on their elements. The schema travels with copy / paste and
templates. It is withheld with its kanban inside a hidden frame. Agents read it from the item.
Concurrent schema edits (two people adding a column at the same moment) are last-writer-wins, as
column edits are today. Board-wide shared fields ("Priority means the same thing in every kanban")
are not in scope. Templates give consistency instead.

### 3. Views

```ts
interface ViewConfig {
  id: string;
  name: string;                                 // "Board", "By owner", "Sprint table"…
  layout: 'board' | 'table' | 'list' | 'calendar' | 'timeline';
  groupBy?: FieldRef | null;                    // board / list / table grouping
  subGroupBy?: FieldRef | null;                 // board: swimlanes (rows)
  groups?: Record<GroupKey, { wip?: number; collapsed?: boolean; w?: number; limit?: number }>;
  groupOrder?: GroupKey[];                      // person / checkbox groups (options have their own order)
  hideEmptyGroups?: boolean;
  filter?: FilterGroup | null;                  // shared filter
  sort?: Array<{ field: FieldRef; dir: 'asc' | 'desc' }>;  // empty = manual order
  card?: { show: FieldRef[]; density: 'compact' | 'comfortable'; color: 'own' | 'group' | FieldRef };
  table?: { columns: Array<{ field: FieldRef; w: number; hidden?: boolean }>; wrap?: boolean };
  calendar?: { date: FieldRef; end?: FieldRef | null };
  timeline?: { start: FieldRef; end: FieldRef; scale: TimelineScale; lanesBy?: FieldRef | null };
}

type FieldRef = string;   // a custom field id or a built-in id ($status…)
type GroupKey = string;   // option id, user id, 'true' / 'false', or '' for "No value"

interface FilterGroup { op: 'and' | 'or'; rules: Array<FilterRule | FilterGroup> }  // nesting ≤ 2 levels
interface FilterRule { field: FieldRef; op: FilterOp; value?: string | number | string[] }
type FilterOp = 'is' | 'isNot' | 'anyOf' | 'noneOf' | 'contains' | 'empty' | 'notEmpty'
              | 'gt' | 'lt' | 'before' | 'after' | 'withinDays' | 'checked' | 'unchecked' | 'isMe';
```

#### Only the Board layout of the collection itself places real cards

This is the central rule that keeps cards canvas-native and still allows many views:

- **Hosting view**: the kanban element showing a `board` tab. Its cards are real canvas items laid
  out in columns (and swimlanes) by `arrange`, as today. You can drag them, connect them, comment,
  vote and react.
- **Projections**: every other presentation, meaning the kanban element showing a table, list,
  calendar or timeline tab, and every *linked view* elsewhere (section 6). A projection draws the
  collection's cards itself, inside its own box, from the live elements. It never moves them. Editing
  in a projection writes the card's fields through the card feature (`card.setValues`,
  `card.setDates`). The real cards keep their board-layout positions and are hidden from the canvas
  while the tab isn't `board`, so switching back is instant and manual order survives.

What a projection draws:

| Layout | Draws | Editing |
|---|---|---|
| table | a typed grid: one row per card, one column per field; grouped sections if `groupBy` | cell editors per type (as typed table cells), Enter / Tab / arrows. A row's handle opens card details. |
| list | compact rows (title + `card.show` chips), grouped | inline title edit, keyboard move between groups |
| calendar | month grid (week on phones). A card sits on its `date` field, spans `date..end` if given. "No date" tray. | drag to a day = `card.setDates` / `card.setValues` |
| timeline | bars from `start` to `end` on the shared `timelineLayout` axis, lanes by `lanesBy` | drag / resize = dates. Connectors are not drawn (they belong to real elements on the canvas). |
| board (linked views only) | cards drawn with the engine's `<ElementPreview>` (the real card component, no editor) | drag between groups sets values. Never moves the real card. |

Projections are fixed-size on the canvas (resizable), scroll inside while selected (like a live
embed takes input only while selected), and render only the rows in view (windowed). A 5,000-row
table therefore costs only the rows on screen and never becomes a 160,000-unit-tall element.

#### The active tab is shared

`activeView` is a synced field. Switching tabs is a write, editors only, and one undo step. On a
shared canvas everyone should see the same thing at the same place. Per-person looks come from
**focus mode** (section 7), which any role can open and which changes nothing for others. Open
question 2 asks whether the tab should instead be per person.

### 4. Group-by and columns are the field's options

- A board groups by **one** single-value field: a custom `select`, a `person`, a `checkbox`, or the
  built-in `$status` / `$assignee`. `multiselect`, date, number and text can't group a hosting board,
  because a real card can't sit in two columns. Projections follow the same rule so the layouts
  agree.
- **Columns are the options**, plus a "No <field>" column that shows when non-empty (or always, with
  `hideEmptyGroups: false`). Adding, renaming, recolouring, reordering or deleting a column edits the
  field's options. Any other view grouped by the same field changes with it.
- **The value is the truth, and the layout follows it.** This is today's `planLayout` rule with
  "status" generalised to "the group field", and it moves into `@freero/shared` (`layout/kanban.ts`)
  so the server lays out by the same rule:
  - a card the local change *moved* into a column takes that column's value (and the option's
    `status`, if set)
  - a card whose group value changed *where it stood* (table cell, card details, MCP, tracker pull)
    moves to the bottom of its new column
  - cards the change didn't touch are never rewritten
- **Deleting an option** that holds cards moves them to the neighbouring option and writes their new
  value, as `removeColumn` does today. Deleting a non-group field leaves values dormant on the cards
  (no mass write, so undo brings the field and its values back). Readers ignore unknown field ids.
- **Changing `groupBy`** re-stacks the visible cards into the new columns in one undo step. It writes
  no values, because the values already say where each card goes.
- **Person groups**: one column per person who has cards, plus "No owner". `groupOrder` keeps a
  manual order. Members without cards appear when "Show all people" is on.

#### Card colour (reconciling phase 1)

Phase 1 makes a card's colour follow its column. Phase 2 generalises this to the view setting
`card.color`:

- `'group'` (default for migrated and new kanbans): the accent is the group option's colour
- `'own'`: the card's stored `color`
- a select field: that field's option colour

Colour is derived when rendering, not written. Regrouping recolours a hundred cards with zero
writes, and the card's own colour survives for when it leaves the kanban. If phase 1 writes `color`
on drop, step 2a switches it to derived. The colours phase 1 already wrote simply become the cards'
own colours.

#### Swimlanes (`subGroupBy`)

The board becomes a grid: columns by `groupBy`, rows by `subGroupBy` (any field allowed as a
`groupBy`). A card's cell is the column and row under its center, and a drop sets both values. Row
headers sit in a left band and collapse individually. Each row's height is its tallest stack.
WIP limits count the column across all rows (the common kanban convention). The geometry lives in
the shared layout so the server can place into a cell (`placement.column` + `placement.row`).

This is a kanban layout, not the `swimlane` diagram element. That one stays the BPMN-style pool
whose items keep free positions.

#### WIP, collapse, width, limits

These are per view and per group (`groups[key]`), because they belong to how a team looks at a
stage, not to the option. Phase 1's per-column collapse and width move there in the migration
(below). `limit` (default 50 for columns with more than 50 cards) shows the first N cards. The rest
are hidden from the canvas with a "Show 340 more" row, which opens the column in focus mode.

### 5. Card display, sort and filter

- **Card display** (`card.show`, `density`): an ordered list of fields to show on cards. `compact`
  is the title plus one line of up to three chips. `comfortable` is the title, a description preview
  and one row per shown field that has a value. The card feature renders it from a **presentation**
  its container hands it (engine addition, below), so the card never reads kanban internals and the
  kanban never draws cards. A card's height depends on the fields it shows, so changing the display
  re-normalises the visible cards (one transaction, one undo step).
- **Sort**: empty means manual order (the vertical order in the column, as today, shared). With a
  sort, cards order by it, dragging within a column is disabled ("Sorted by Priority · Clear to
  reorder by hand"), and moving between columns still works.
- **Shared filter**: cards that don't match are hidden from the canvas and from projections, and
  the column says "3 hidden by filter". Arrange stacks only the shown cards. The filter is in the doc,
  so every client and the server compute the same layout.
- **Filter for me** (any role, not synced): on a hosting board it **highlights** matches and dims
  the rest, because real cards have shared positions and hiding them for one person would leave holes
  and break pointing ("the card under my cursor"). Projections and focus mode really filter for me.
  This reuses the engine's local view state (as "Hidden for me" does).
- **Locking** the kanban (existing `locked`) locks its schema and views. Cards stay editable, as
  today.

### 6. Several views of one collection

- **Tabs on the collection**: a kanban carries several `views`, and its header shows them as tabs
  (Board · Table · By owner · Calendar). Adding a view is "+ View", choosing the layout and grouping.
- **Linked views**: a new element type `kanbanview` (label "Linked view") with `sourceId` (the
  kanban) and one `ViewConfig`. It can sit anywhere on the same board, for example a calendar of the
  sprint next to the planning frame. It is always a projection. If its source is deleted, it shows
  "The collection was deleted · Undo" and holds nothing. If the source is not visible to the viewer
  (hidden frame, someone's private draft), it shows "Not visible to you" and leaks nothing, because
  it stores only `sourceId` and config with option ids, never labels. A free-text filter value (e.g.
  `contains "layoffs"`) is stored on the linked view itself, which is acceptable and documented.
- **Staying in sync** needs no machinery: every view reads the same live elements. There is no copy
  to reconcile.
- **Across boards** (step 3d, separate decision): a linked view whose source is on another board,
  addressed as `freero://board/<id>/item/<kanbanId>`. Each viewer's own access to the source board
  decides what they see ("No access · Request access" otherwise, as for doc embeds). Rendering it by
  connecting the whole source board's doc, as native doc embeds do, would load a full board to show a
  table, so the proposal is a server projection endpoint instead: rows for one collection, permission
  checked, with live updates over the board's socket protocol, and writes through `modules/api`. This
  overlaps with #56 (board-in-board) and is open question 3.

### 7. Focus mode: the per-person, accessible, phone-friendly way in

"Open as page" on any collection or linked view opens a full-screen `dialog` panel with every
layout. In it, switching layout, filtering, sorting and grouping are **local** (for me) unless an
editor presses "Save to view". It is:

- the way **viewers and commenters** re-slice data without writing
- the **accessible** path: real DOM rows and cells with `role="grid"`, `aria-rowcount` while
  windowed, normal focus order, labelled controls. Today board items aren't DOM focus targets (#29).
- the **phone** path: on phones a collection opens here by default, as a list grouped by column,
  swiping between groups, with card details as a bottom sheet
- where "Show 340 more" goes

### 8. Engine additions (additive, `engine/api.ts`)

1. `ElementDefinition.presentChild?(container, child, editor) → ChildPresentation | null`
   (`{ accent?, fields?: Array<{ id, label, display: FieldDisplay }>, density? }`), handed to the
   child as `ElementRenderProps.presentation` and to its `normalize` as context. When the container's
   `presentationKey(container)` changes, the engine re-normalises its children in the same
   transaction. Cards render chips without importing the kanban feature.
2. `ElementDefinition.hidesChild?(container, child, editor) → boolean`: children the container draws
   itself or hides (non-board tab, shared filter, beyond `limit`). They are treated like `hidden`
   elements (not rendered, hit-tested, exported, in bounds or the Tab walk). They stay board content
   for the outline, search, find and copy. Find "opens" such a hit through the container's
   `runCommand('kanban.reveal', { id })`, which opens card details.
3. `useWorldViewport()`: the visible world rect, for windowed projections. It is quantised like
   `zoom` so panning doesn't re-render every row each frame.
4. `Editor.announce(text)` (if still absent): spoken confirmations such as "Moved Fix login to
   Doing", through the engine's live region. Features never add live regions of their own.

### 9. Ownership (Dune)

| Durable value | Single writer | Others |
|---|---|---|
| `KanbanElement.fields / views / activeView / columns` | `features/kanban` | `runCommand('kanban.*')`. Server: `modules/api` service through realtime `changeBoard` |
| `KanbanViewElement` (linked view) | `features/kanban` (second element in its `element.tsx` array) | same |
| `CardElement.values`, built-in card fields | `features/card` (`card.setValues`, `card.setDates`, `card.setEstimate`) | **one exception, as today with status:** the kanban's `arrange` writes the group values (and option `status`) of cards it hosts when they are dropped. Server: `modules/api`, `modules/trackers` |
| `tags` vocabulary | `features/tags` | unchanged (`$tags` reads it) |
| Typed value logic (canonical, validate, compare, filter, group, CSV text, infer type) | `@freero/shared/fields` (pure) | moved out of `features/table/lib/columns.ts`. Table, kanban, card, csv and the server all import it. |
| Kanban + swimlane geometry, `planKanban` | `@freero/shared/layout/kanban.ts` (pure) | the kanban's `arrange`, `modules/structure` placement, `modules/api` / `modules/trackers` re-lay |
| Field value pickers (option picker with colours, person picker, date picker, number input) | `@ui` (props only, no editor) | card details dialog, table cells, kanban column menus |

Feature folders touched: `kanban` (grows: `lib/schema.ts`, `lib/views/{table,list,calendar,timeline}.tsx`,
`lib/filter.ts`, `panel.tsx` for the Fields / View settings dock and focus-mode dialog),
`card` (values, presentation rendering, details dialog fields, `card.setValues`), `csv`,
`templates`, `table` (imports the shared value logic, gains "Convert to kanban"), `trackers` (UI
for the status mapping). No new feature folder is needed. The kanban feature's description is
updated to "Kanban boards and collections".

Server modules: `structure` (place into an option / cell, kanban structures with fields), `api`
(collection endpoints, values in `updateItems`), `mcp` (tools wrap `api`), `trackers` (status by
option, field map), `outline` (no code: features' `outline.ts`), `search` (index values by label),
`activity` / `events` (describe value changes by field name), `notifications` (person fields: later,
see the plan). No tables: everything is board content.

### 10. Yjs document structure, concretely

```
elements (Y.Map, whole-value per key)
  k1  → { type:'kanban', title, colW, w, h,
          fields: [ { id:'stage', name:'Stage', type:'select', options:[
                        { id:'c_todo', label:'To do', color:'#8A89A3', status:'todo' },
                        { id:'c_doing', label:'Doing', color:'#2E9BF0', status:'doing' },
                        { id:'c_done', label:'Done', color:'#1FA463', status:'done' } ] },
                    { id:'f_prio', name:'Priority', type:'select', options:[…] },
                    { id:'f_pts', name:'Points', type:'number' } ],
          views: [ { id:'v_board', name:'Board', layout:'board', groupBy:'stage', subGroupBy:null,
                     card:{ show:['f_prio','$assignee','$due'], density:'compact', color:'group' } },
                   { id:'v_table', name:'Table', layout:'table', sort:[{ field:'f_prio', dir:'asc' }] } ],
          activeView: 'v_board',
          columns: [ …derived cache of the board view's groups… ] }
  c1  → { type:'card', frameId:'k1', x, y, w, h, title, status:'doing', assigneeId, dueDate,
          values: { stage:'c_doing', f_prio:'o_p1', f_pts:3 } }
  lv1 → { type:'kanbanview', sourceId:'k1', w, h, view: { layout:'calendar', calendar:{ date:'$due' } } }
```

No new top-level maps and no new collections, so `Y_KEPT_ON_RESTORE`, `ELEMENT_CONTENT_COLLECTIONS`,
commenter rules and layer moves are untouched.

**Conflicts**:

| Concurrent case | Result |
|---|---|
| A and B drag different cards | merge (different keys). Arrange's existing 5-second re-plan settles two drops into one slot. |
| A and B drag the same card to different columns | last writer wins, and position and value stay consistent (one write) |
| A edits Priority in the table while B drags that card | last writer wins on the card: one change is lost (see Risks) |
| A deletes option "Doing" while B drops a card into it | the card's value points at a missing option and lands in "No Stage". Nothing is lost, and anyone can move it. |
| A changes `groupBy` while B drops a card | both apply. B's drop wrote B's group value, and the next local arrange stacks it by A's grouping. |
| A and B add a column at the same moment | last writer wins on the kanban element: one column is lost (as today) |
| Two old-format clients migrate one kanban at once | identical results: migration is deterministic (below) |

**Undo**: every change is a local Editor write inside one gesture or transaction: one step per drop,
cell commit, field edit, group-by change (with its re-stack) or display change (with re-normalised
heights). Remote changes are never undone. Dormant values make "delete field → undo" lossless with
no mass writes.

**Permissions**: board roles apply unchanged. Editors change schema, views, values and tabs.
Commenters comment on cards, and from a table row "Comment" opens the card's thread
(`comments.openThread`), because cards are still elements. Viewers read, and use focus mode and
"filter for me". Hidden frames and private drafts withhold the whole kanban with its schema and
cards, because they are one element subtree. Locked kanban = locked configuration. Workspace
"downloads" policy hides CSV export as it does today.

### 11. Migration of existing kanbans

The migration is **read-time and deterministic**, with no job:

- `collectionSchema(kanban)` (shared) returns the schema. For a kanban without `fields`, it
  synthesises the field `{ id: 'stage', name: 'Stage', type: 'select' }`, whose options are the
  columns *with the column ids as option ids*, keeping title (as plain text), colour and `status`. It
  also synthesises one view `{ id: 'board', layout: 'board', groupBy: 'stage' }` carrying each
  column's `wip` and phase 1's collapse / width into `groups[columnId]`. Two clients doing this at
  once produce byte-identical results, and outline section ids `<kanbanId>:<columnId>` stay valid.
- A card's group value: `values.stage`, else the column under its center (today's rule). Arrange
  writes the value only when it touches the card, so stale boards are never rewritten by whoever
  happens to edit next (the rule `planLayout` already follows).
- The first local edit of the kanban persists `fields` / `views` (normalize).
- **Built-in status stays.** Options keep their `status` mapping, so trackers, notifications, CSV
  and the done styling read `status` as before. A kanban may also group directly by `$status`.
- **Older clients and the server during rollout**: the kanban keeps writing `columns` as a cache of
  its board view's groups (title, status, wip, colour, id = option id), so a stale tab or PWA, and
  any server code not yet moved, keep stacking by geometry and setting status. Stale clients only miss
  custom fields. In the same release, the server modules switch to `collectionSchema`.

### 12. Agents: MCP and REST

Agents must be able to do everything people can. Additions follow the existing tools' style (placed
by meaning, ids returned in order, all-or-nothing, `untrusted_board_content` envelope on reads).

**Outline** (`docs/board-outline.md`, additive in `outlineVersion: 1`):

```
- [k1] kanban: Sprint · grouped by: Stage · rows: Team · fields: Stage (select: To do | Doing | Done), Priority (select: P0 | P1 | P2), Owner (person), Points (number) · views: Board*, Table, Calendar
  - column "Doing" [k1:c_doing] · status: doing · wip: 3
    - [c1] card: Fix login · Stage: Doing · Priority: P1 · Points: 3 · assignee: Ann · due: 2026-11-04
- [lv1] linked view: calendar of [k1] by due
```

JSON gains `OutlineItem.schema?: Array<{ id, name, type, options?: Array<{ id, label, status? }> }>`
and `views?`. Card `fields` gain the custom fields keyed by field **name** (values as labels / ISO
dates / numbers). Section ids stay `<kanbanId>:<optionId>`, and swimlane cells add
`<kanbanId>:<optionId>:<rowKey>`.

**MCP tools** (`modules/mcp/tools.ts`, each a thin wrapper over an `api/service.ts` operation):

| Tool | What it does |
|---|---|
| `define_fields` | On a kanban: add / rename / retype (with conversion as tables do) / delete fields and options, by id or name, in one step. Returns ids. `{ boardId, kanbanId, fields: [{ id?, name, type?, options?: [{ id?, label, color?, status? }], delete? }] }` |
| `add_cards` (extended) | Card items take `fields: { "<name or id>": value }`. `columns` mode takes `fields` (definitions) and `groupBy`. `placement` takes `row` for swimlanes. |
| `update_items` (extended) | Cards take `fields: { … }` (merged server-side into `values`; `null` clears). `into` a kanban column sets the group value, as a drop does. The server re-lays the kanban in the same change (`planKanban`), so open boards see the card move without a client re-lay. |
| `configure_view` | Create, change or delete a view on a kanban, or set the active tab: layout, groupBy, subGroupBy, filter, sort, card display, WIP, column order |
| `add_view` | A linked view of a kanban, placed by Freero (`near` / `placement`) |
| `query_cards` | Read a collection as rows with server-side filter / sort, the fields to return, `limit` ≤ 500 and `cursor`. It is how an agent reads 2,000 cards without blowing the outline budget. JSON rows `{ id, title, fields: { name: value } }`. |

Values are validated with the shared canonical rules. Unknown option labels are refused with the
valid ones listed, unless `createOptions: true` is passed.

**REST** (`/api/v1`, `docs/api/openapi.json`, scopes `boards:read` / `boards:write` /
`boards:suggest`):

```
GET    /boards/{boardId}/kanbans/{kanbanId}                 schema + views
PUT    /boards/{boardId}/kanbans/{kanbanId}/fields          define_fields
GET    /boards/{boardId}/kanbans/{kanbanId}/cards           query_cards (filter, sort, cursor)
PATCH  /boards/{boardId}/kanbans/{kanbanId}/cards           batch field values (≤ 500)
POST   /boards/{boardId}/kanbans/{kanbanId}/views           configure_view (create)
PATCH  /boards/{boardId}/kanbans/{kanbanId}/views/{viewId}
DELETE /boards/{boardId}/kanbans/{kanbanId}/views/{viewId}
```

`ApiItem.data` already exposes `values` / `fields` raw. Responses add a `fieldsByName` convenience.
Suggest-only connections propose value changes and schema changes as element patches
(`propose_changes` with `kind: 'update'`), which works because both live on elements. Webhooks and
events: value changes are item changes, and `board.content` events name the changed fields by
name.

### 13. Tracker sync

- **Status**: a kanban grouped by an option-mapped field keeps today's category mapping (option
  `status` ↔ todo / doing / done). New: when the issue's status *name* equals an option label
  (case-insensitive), that option wins over the category. "In review" lands in an "In review" column
  instead of the first "doing" column, and moving a card there sends the transition to "In review".
  Import offers "Add columns for the tracker's statuses" (one option per status name seen, mapped by
  category).
- **Fields**: `$tags` ↔ labels and `$assignee` ↔ assignee, unchanged. New built-in mapping for a
  select field named "Priority" ↔ Jira / Linear priority (by name match), and `$estimate` /
  `$start` / `$due` as now. Other custom fields stay on the board unless the connection has a field
  map (#43: a per-connection `{ fieldId → tracker field }`), merged with the existing per-field rule
  (`mergeField`: one-sided changes flow, conflicts keep the tracker's value and put the board's in a
  comment). `ISSUE_FIELDS` gains `priority` and `custom:<id>`.
- Pulls that change a group value re-lay the kanban in the same server change, as roadmap pulls
  re-lay timelines.
- `import_from_tracker` with `placement.into` a kanban maps statuses and priority onto the fields,
  creating options only when asked.

### 14. Templates

- The `kanban` spec archetype (`lib/spec/types.ts`) gains `fields?: Array<{ name, type, options? }>`,
  `groupBy?`, `rows?` (swimlane field) and per-card `values` by field name. The `Kit`'s `kanban(…)`
  writes `fields` / `views` on the element. The 17 kanban specs and 5 hand-coded kanbans keep working
  unchanged: they read as the Stage migration.
- The template gate adds checks: field names unique, values valid for their field (an option that
  exists, a parseable date), groupBy a groupable field, no more than 12 fields, options ≤ 20 in
  templates. Each check comes with a test on a deliberately broken spec.
- A first batch of templates that need fields: sprint board (Priority, Points, Owner, swimlanes by
  Team), hiring pipeline (Role, Owner, Next step date), content calendar (Channel, Publish date,
  calendar view), bug triage (Severity, Area). Freero's own wording and examples.

### 15. Export and import (CSV)

- **Export** "Download as CSV" on a kanban (or a view, honouring its filter and sort): one row per
  card. Columns are Title, Description, then each field by name in view order, then Status,
  Assignee, Due date, Start date, Estimate, Tags, Link. Selects are written as labels, multiselect
  as labels joined by `; `, persons as names (email column optional, when allowed), dates ISO,
  numbers raw, checkboxes TRUE / FALSE. Formula injection guard as today (`csvCell`).
- **Import** into a kanban: the existing mapping dialog gains "New field" per unmapped column with
  the inferred type (`inferType`, moved to shared). Distinct values become options (≤ 50, else
  text). One column is chosen as the group field. Rows become cards stacked in their columns, in one
  undo step.
- **Table ↔ kanban**: "Convert to kanban" on a table (rows → cards, typed columns → fields, select
  labels → options) and "Copy as table" on a view. The table element stays the free-form sheet. See
  open question 4.

### 16. Accessibility

- Every field value has a text form: chips carry their label, colour is never the only signal, and
  forced-colours outlines are drawn on chips and columns.
- Keyboard: phase 1's card moves (between columns) extend to swimlane rows (Alt+Shift+↑ / ↓ move
  rows, if phase 1 binds columns to Alt+Shift+← / →; declared in `keys` so the `?` sheet lists
  them). In projections, arrows walk cells, Enter edits, Escape leaves the view.
- Card details dialog: real labelled form controls per field, in schema order.
- Announcements through `Editor.announce`: "Fix login moved to Doing, Team Web", "Filter hides 12
  cards".
- Focus mode is the screen-reader path to full data (`role="grid"`).
- Reduced motion: no animated re-stacks.

### 17. Mobile

Phone layout (≤ 600 px): tapping a kanban offers "Open" → focus mode list. Columns are horizontal
swipe pages, and long-press on a card → "Move to ▸" sheet (no drag needed). Field editing happens in
the bottom-sheet card details. In phone-edit mode the canvas board still works (drag with the coarse
pointer sizes). Calendar on phones is the week / agenda variant.

### 18. Performance budget (1–5k cards)

| Concern | Approach | Target |
|---|---|---|
| Doc size | ~0.9 KB per card with values → ~4.5 MB at 5k | Soft cap 5,000 cards per kanban and a warning at 2,000 suggesting a tracker as system of record. Load < 2 s on a mid laptop (measure) |
| Canvas rendering | `limit` per column (default 50): cards beyond it are `hidesChild` and not laid out. Culling as today. | ≤ ~600 real cards drawn per kanban |
| Arrange | `planKanban` O(n log n), positions only shown cards, so a regroup writes at most the visible ones | < 5 ms for 5k children per local change |
| Unrelated edits | `KanbanView` moves from `useElements()` (re-render on every board change) to `useElementsQuery` (its children's group counts only). The engine skips `arrange` for containers whose subtree the change didn't touch (measure first). | no kanban re-render while typing in a sticky elsewhere |
| Projections | windowed rows by `useWorldViewport`. Group / sort / filter memoised per view on the children's identity. | 60 fps scroll at 5k rows. 16 ms budget for a value change |
| Big writes | regroup or display change: one transaction with only visible cards. CSV import: chunked `createMany` within one undo step. | < 1 s for 600 cards |
| Server | outline / `query_cards` read element JSON (no extra index). `query_cards` paginates. | 500-row page < 200 ms |

A benchmark script (`scripts/bench-kanban.mjs`, not a unit test) builds 5,000 cards and reports
these numbers. It runs before each phase-3 step merges.

### 19. Testing strategy

Per ARCHITECTURE.md "What a test is for": scenario tests named after the failure they prevent, the
strongest one per bug, no label, constant or snapshot tests. The ones this design needs:

- shared `collectionSchema`: *two clients migrating the same old kanban never create two Stage
  fields* (identical output). *A legacy card with no value keeps its column.*
- shared `planKanban`: *a card dropped into a column takes that option and its status*. *A value
  changed in the table moves the card to its column*. *Cards the change didn't touch are never
  rewritten*. *A swimlane drop sets both values*. *A filtered-out card frees its slot and doesn't
  count against WIP*.
- `createTestBoard` (two real replicas): *concurrent drops of two cards into one column both stack*
  (existing test kept). *An option deleted while a card is dropped into it leaves the card in
  "No value", not lost*. *A regroup and a concurrent drop converge on every client*.
- card: *a card's own colour survives grouping by colour and leaving the kanban*. *Deleting a field
  and undoing it brings the values back*.
- projections: *editing a cell writes the card through card.setValues* (one undo step). *A
  projection never moves a real card*.
- server (`modules/api`, `mcp`): *update_items with fields re-lays the card in the same change*. *An
  unknown option label is refused with the valid ones*. *The outline reads custom fields by name and
  a swimlane cell id addresses placement*. *A suggest-only agent's field change is a proposal, not a
  write*.
- trackers: *an issue moved to "In review" lands in the "In review" column, not the first doing
  column*. *A board change and a tracker change to Priority in one window keeps the tracker's and
  comments the board's*.
- templates gate: one deliberately broken spec per new check.
- verification in the real app (`verify-freero` skill): drag between columns and lanes, switch tabs,
  edit in the table, two browsers.

## Phased plan

Each step ships on its own, keeps `npm run check` green, and leaves existing boards working. Effort
is rough, for one agent with review, in working days.

| Step | Ships | Effort |
|---|---|---|
| **2a Schema foundation** | `@freero/shared/fields` (types, canonical values, validation, compare / filter / group, typed logic moved from table), `layout/kanban.ts` (`planKanban` by value, moved from the kanban feature), `collectionSchema` read-time migration, `columns` cache. `CardElement.values` and `card.setValues`. Kanban "Fields" panel: add / rename / delete fields and options. Column menu edits the Stage options. Card details dialog edits custom fields. Outline reads fields. | 5–6 |
| **2b Card display** | engine `presentChild` + re-normalise. View `card.show` / density / colour-by (phase 1's colour becomes derived). Field chips on cards. | 3–4 |
| **2c Group by any field + swimlanes** | `groupBy` select / person / checkbox / `$status` / `$assignee`, person columns, `subGroupBy` grid layout (shared geometry), drop sets both, row collapse, WIP / collapse / width per group, `limit` + engine `hidesChild` | 6–8 |
| **2d Filter and sort** | shared filter (hides, counts), "filter for me" highlight, sort with manual disabled, view lock via kanban lock | 3–4 |
| **2e Agents and API** | `define_fields`, `configure_view`, `query_cards`, `fields` on `add_cards` / `update_items` (server re-lay), REST endpoints + OpenAPI, structure placement by option / row, docs (mcp.md, board-outline.md, api README) | 4–5 |
| **2f Trackers, templates, CSV** | status-name → option mapping, Priority, import "add columns for statuses". Kanban spec `fields` + gate checks + the first field templates. CSV export / import with fields | 5–6 |
| **3a Tabs + Table projection + focus mode** | `views[]` tabs and `activeView`, cards hidden while not on board, windowed table with typed editors (`useWorldViewport`), focus-mode dialog (local settings, `role="grid"`, phone default) | 8–10 |
| **3b List, Calendar, Timeline projections** | the three layouts in tabs and focus mode, drag to dates via `card.setDates` | 8–10 |
| **3c Linked views on the same board** | `kanbanview` element, outline line, `add_view`, source deleted / not visible states | 4–5 |
| **3d Cross-board linked views** | server projection endpoint with live updates, per-viewer access, writes through the API. Only after open question 3. | 10–15 |
| **3e Table ↔ kanban conversion** | "Convert to kanban" / "Copy as table". Closes most of #51. | 3 |

Phase 2 is ~26–33 days. Phase 3 is ~23–28 days without 3d. 2a must land first. Then 2b, 2c and 2d
are independent, and 2e / 2f depend only on 2a (2e's view tool grows as 2c / 2d land). 3a needs 2a +
2b, and 3b / 3c need 3a.

## Risks

1. **Per-element last-writer-wins.** Two people changing different fields of one card in the same
   sync window, or an offline client returning, keep only one change. It is already true for built-in
   card fields. With more fields per card it will show more. Mitigation: values and position travel
   together (no inconsistent state). If it is reported, propose an engine change to per-field element
   merges (elements as nested `Y.Map`s), a doc-format change that needs its own design and
   compatibility plan.
2. **Hidden children vs engine assumptions.** Selection, find, Tab walk, exports, layers, connectors
   attached to a hidden card, comments pinned to it. `hidesChild` must be honoured everywhere
   `hidden` is. Connectors to a hidden card hide with it (`hiddenWith`). An engine review and the
   2c tests cover it.
3. **Doc size and big writes at 5k cards.** Whole-element writes make a regroup or display change
   heavy. Mitigated by laying out only visible cards and by the soft cap, and measured by the
   benchmark before 3a.
4. **Rollout with stale clients.** The `columns` cache keeps old tabs and PWAs coherent, but they
   can't show or edit custom fields and may drop a card by geometry into an option-mapped column. The
   result is still correct, because the value follows the column there.
5. **Phase 1 overlap.** Phase 1 is changing the same files (`kanban/lib/layout.ts`, actions, the card
   colour). Step 2a moves `planLayout` into shared and must start from phase 1's merged code. Its
   per-column settings are read into `groups[columnId]`.
6. **The kanban feature grows large.** Split into `lib/` modules per concern from the start
   (schema, layout glue, each projection). The Dune check keeps it from importing other features.
7. **Two "database" models** (table cells vs card values) until the owner decides question 4.
   Sharing `@freero/shared/fields` keeps parse / format / sort / filter identical.
8. **Tracker mapping ambiguity** (two options with the same status name, priorities that differ per
   tracker). Name matching is predictable and visible. The explicit per-connection map (#43) is the
   way out.

## Decisions (owner, 2026-11-02)

1. **Dragging a card out of a kanban leaves the collection** (dropping in joins, dragging out
   leaves), as today: membership is containment (`frameId`), no `collectionId` on cards.
2. **View changes are personal until saved.** Changing a view's layout, filter, sort or grouping
   applies only to the person who made it, until they press **"Save for everyone"** (editors only).
   Viewers can always look their own way without changing it for others. This replaces section 3's
   "the active tab is shared": `views` / `activeView` on the element become the *saved* view
   everyone starts from, and each person's unsaved changes are a personal override on top
   (storage below).
3. **Cross-board views are in this round.** Pasting a kanban onto another board offers
   **"Synced"** (a linked view of the same collection; permissions are the home board's: someone
   with only view access there can't edit records or change its saved view) or **"Copy"** (an
   independent kanban with its own cards). Step 3d is no longer conditional.
4. **The table element stays a separate free-form sheet**, with "Convert to kanban" (3e). Table,
   Timeline and Calendar are layouts of a kanban's own cards (3a / 3b).

What these need from the data model, and what 2a does about it:

- **Collection identity** is the kanban element id; across boards a collection is addressed as
  `freero://board/<boardId>/item/<kanbanId>` (the object address the suite already resolves).
  There is deliberately no separate `collectionId`: duplicate, paste and templates give copies new
  element ids, so a "Copy" is independent by construction, while a stored `collectionId` would be
  copied verbatim and make two kanbans claim one collection. A synced view (3c / 3d) stores
  `{ boardId, kanbanId }` and never its own copy of the schema or the cards.
- **Saved vs personal view settings.** Saved: `KanbanElement.views[]` (+ `activeView`), written by
  editors through the kanban feature like any element change (synced, undoable, travels with copy /
  paste). Personal: a `Partial<ViewConfig>` per person per view, keyed by
  `(boardId, kanbanId, viewId)`. It can't live in the board doc (viewers never write the doc, and it
  must not reach other people), so it is per-user state outside the doc: a small per-user store
  behind a `Host` method (server-side, follows the person across devices), with the engine's local
  view state as the offline / guest fallback. "Save for everyone" writes the override into
  `views[]` and clears it. Nothing in 2a writes views (see below), so nothing has to migrate.
- **Synced views and permissions** (3d): the linked view reads and writes through the home board's
  access (server projection endpoint, writes through `modules/api`), so the home board's role
  decides, per person, whether records and the saved view are editable.

## Step 2a as built

What shipped, and where it differs from the proposal above (with why):

- **`@freero/shared` `fields.ts`**: `FieldType`, `FieldDef`, `FieldOption`, `FieldValue`,
  `collectionSchema` (the read-time migration), `storedFields`, `canonicalValue` / `readValue`
  (validation, canonical encodings as in section 2), `cardValue`, `valueText`, `optionByLabel`,
  `fieldNameProblem`, the built-in fields (`BUILTIN_FIELDS`, `builtinValue`, `builtinPatch`) and
  limits. `KanbanElement.fields?` and `CardElement.values?` are additive.
- **The column field's options are the `columns`, never copied into `fields`** (deviation: the
  proposal kept options in `fields` and `columns` as a cache). The column field (id `stage`,
  default name "Stage") keeps only its name and place in `fields`; its options are read from
  `columns` (column id = option id; title as plain text, colour and status). Why: old tabs, PWAs
  and server code (structure placement, trackers, control room) edit `columns`, and with two copies
  every such edit would silently diverge from the field on new clients. With one copy, an old
  client's added or renamed column *is* a new or renamed Stage option, and migrating needs no write
  at all: a kanban without `fields` reads as `[Stage]`, deterministically on every client and the
  server. In 2c the invariant generalises to "the field the board is grouped by keeps its options
  in `columns`": switching `groupBy` moves the old group field's options into its `fields` entry
  and the new one's out into `columns`, in one write.
- **A card's column-field value is the column under it, never stored in `values`** (deviation: the
  proposal wrote `values.stage` on drop and read it before position). On a hosting board the
  position is written by every client, old ones included, so it is the only value that can't be
  stale; and a move changes it in one write. Setting it (card details, `card.setValues`) asks the
  kanban to move the card (`kanban.moveToColumn`), and the layout pass then sets the column's
  status and colour as for a drop. In 2c, regrouping away from Stage writes `values.stage` from
  positions in the same transaction, after which Stage is an ordinary stored select.
- **`card.setValues`** (card feature) writes custom values and built-in fields by their fixed ids
  in one undo step; values that don't fit their field are ignored. Deleting a field or an option
  writes no card: values stay dormant and read as empty (undo brings them back).
- **Fields panel** (`features/kanban/panel.tsx`, a dock opened from the kanban's toolbar "Fields"
  button or its context menu "Edit fields…"): add (any of the eight types), rename (unique,
  case-insensitive, not a built-in name), reorder and delete fields; add, rename, recolour (the
  Freero column palette), reorder and delete options. The column field's options are edited as
  columns, including "Sets status"; it can be renamed but not deleted. Read-only for viewers and
  on locked kanbans.
- **Card details** ("Open details") show the kanban's fields in schema order with a labelled
  control per type; each change is one `card.setValues`.
- **Outline**: kanbans carry `schema`, cards carry their values by field name (docs/board-outline.md).
- **`update_items` takes `fields`** for custom fields (by name or id, select options by label;
  unknown fields / options refused with the valid ones). This is the part of 2e that was trivial
  because it is a card patch; `define_fields`, `configure_view`, `query_cards`, `add_cards` with
  fields and server re-lay of value changes are still 2e.
- **Built-in fields**: `$estimate` is typed `text`, not `number` (planning poker stores "XL", "?");
  `$created` / `$updated` are read-only `timestamp`s. `$tags`' options are the board's tag
  vocabulary.
- **Not in 2a, moved later**: `views` / `activeView` are not written yet (nothing reads them; WIP,
  collapse and width stay on `columns` until 2c introduces views and reads them into `groups`).
  Card colour stays phase 1's write-on-move (`colorCards`): the Stage option colour *is* the column
  colour, so the two already agree; colour-by becomes derived in 2b with `presentChild`, as the
  plan table says. Moving `planLayout` into `@freero/shared` (`planKanban`) waits for the first
  server writer that needs it (2e's re-lay after a value change); moving the table's typed logic
  (`features/table/lib/columns.ts`) into `fields.ts` waits for 2d, where filter / sort / compare
  are first shared.

What the next steps need:

- **2b**: engine `presentChild` / `presentationKey` and card chips; `views[]` with `card.show`,
  density and colour-by (derived; phase 1's written colours become the cards' own colour).
- **2c**: `groupBy` (moving options between `columns` and `fields`, writing `values` of the old
  group field from positions), person / checkbox groups, swimlanes, per-group settings in
  `views[].groups` (read from `columns` on first write), `limit` + engine `hidesChild`, and the
  "value changed where it stood moves the card" rule for stored group fields in `planLayout`.
- **2d**: filter / sort / compare in `fields.ts` (with the table's logic moved there), "filter for
  me" from personal view state.
- **2e**: `define_fields`, `configure_view`, `query_cards`, `fields` on `add_cards`, `update_items`
  setting the column field by value (server `planKanban` re-lay), REST endpoints, docs.
- **2f**: trackers by option, templates with fields, CSV with fields.
- **Phase 3**: views tabs with personal overrides (decision 2: per-user store behind `Host`),
  projections, focus mode; linked views on the same board (3c) and across boards with
  Synced / Copy on paste (3d, decision 3); "Convert to kanban" (3e, decision 4).

## Step 2b as built

- **Engine** (`engine/api.ts`): `ElementDefinition.presentChild(container, child, { editor,
  personal })` → `ChildPresentation` (`accent`, `chips: FieldChip[]`, `density`), handed to the
  child's component as `ElementRenderProps.presentation` and, computed with `personal: false`, to
  its `normalize` (`NormalizeContext`); `presentationKey(container)` re-normalises the children in
  the same transaction when it changes (one undo step with the re-stack). Personal view state:
  `Editor.getPersonalView` / `setPersonalView` + `usePersonalView`, kept through
  `Host.personalViews` (server module `personalviews`, table `personal_views`: per user, board,
  item and view; any role that can open the board; 4 KB per entry, 200 per board; in the data
  export), else in this browser (sandbox, guests, embeds).
- **`@freero/shared` `views.ts`**: `ViewConfig` (`id`, `name`, `layout: 'board'`, `card: { show,
  density, color }`), `boardView(k)` (read-time: a kanban without `views` has one, with the footer
  cards always had — status, due, tags, estimate, assignee — comfortable density, and colour by
  column exactly when `colorCards` is on), `ViewOverride` / `cleanOverride` / `withOverride` /
  `overrideBetween`, `savedViews` (writes the view and keeps `colorCards` = "coloured by column"
  for older clients), `cardChips`, `cardAccent`.
- **Card colour is derived** (`card.color`: `'group'` = the column's colour, `'own'`, `$status`, or
  a select field's option colour). Moves never write colour any more; the colours phase 1 wrote are
  simply the cards' own colours now. Phase 1's toolbar toggle became "Colour by" in the View panel;
  `colorCards` stays meaningful as the mirror older clients read (they keep writing the column
  colour on move, which is harmless: new clients draw the derived colour).
- **Personal vs saved (decision 2)**: which fields cards show (and their order) and what colours
  them are personal until "Save for everyone" (editors, unlocked kanbans; one undo step; the
  override is cleared). **Deviation:** density is not personal. It changes card heights, which are
  the shared board's geometry (every client stacks by them), so it is saved directly, editors only.
- **Density** (deviation from "compact = one line of up to three chips, comfortable = one row per
  field"): both densities have one line of chips (the card's footer, clipped when it overflows);
  comfortable also shows the description preview, compact doesn't. That keeps card height
  independent of which fields show, so `show` can be personal without moving anything. (#95,
  later: the line no longer clips chips mid-word. It wraps inside a box one chip tall, so a chip
  that doesn't fit whole drops out of sight and a "+N" chip counts them, their values in its
  tooltip; a label too long even alone ends in an ellipsis, its full value in the chip's tooltip.
  The height invariant holds.)
- **View panel** (dock `kanban.view`: the toolbar's "View" button, "View settings…" in the context
  menu; any role): "Only you see these changes · Save for everyone · Reset", density (editors),
  colour by, fields on cards (toggle and reorder). Commands `kanban.setCardDisplay` and
  `kanban.saveViewForEveryone` do the same for other features and tests.

## Step 2c as built

- **The group field** (`fields.ts` `groupFieldId`): the board view's `groupBy` when it names a
  stored single select, person or checkbox field, else the column field "Stage". The invariant 2a
  set up generalises: the group field's options are `columns` (a select's option id = column id;
  person columns are user ids, checkbox columns `true` / `false`, and select / person groupings
  have a "No <field>" column, id `~none`, first), and a card's value for it is the column it
  stands in (`cardValue`); every other field is stored on the card — Stage too while the board is
  grouped by something else (its options then live in its `fields` entry, `status` mapping kept).
- **Regrouping** (`lib/group.ts` `setGroupBy`, View panel "Group by", `kanban.groupBy`) is one
  transaction and one undo step, as the 2a report described: the old group field's values are
  written onto the cards from their positions, its options go back into its `fields` entry, the new
  field's options become `columns` (its stored values are dropped: the column says it now), each
  card moves to its value's column, and the old field's column settings (WIP, collapsed, card
  limit) are kept in the view's `groupSettings` and restored when the board is grouped by it
  again. A regroup is no drop: the layout writes no status then. Person columns: one per person
  who has cards; giving a card to someone without a column adds theirs (`kanban.moveToColumn`).
  Columns that are a select's options are added, renamed and deleted as options; people, checkbox
  values and "No <field>" only change their look and limits.
- **"A value changed in place moves the card"**: for the grouped field it is `card.setValues` →
  `kanban.moveToColumn` (positional, as Stage in 2a), for a swimlane field the layout moves a card
  whose stored row value changed where it stood to the bottom of that row.
- **Swimlanes** (`subGroupBy`, View panel "Swimlanes", `kanban.setSwimlanes`): rows by a second
  groupable field. Unlike the columns, a row value is **stored** on the card (older clients restack
  columns without rows; a positional row value would be rewritten by them, a stored one survives
  and the next new client lays the rows out again). A card the change moved (a drop, a new card)
  takes the row under its center and the layout writes that row's value in the same step (with the
  column's status, as for any drop): one write sets both. The rows' heights are cached on the
  element (`lanes`, like `h`) so a drop, the render and `kanbanLaneAt` agree. Keyboard ↑ / ↓ move
  within the cell.
- **Card limit per column** (`KanbanColumn.limit`, column menu "Cards shown"): the first N items of
  the column (in each row) show; the rest stay in it, stacked below the board, and are folded away
  with the existing engine hook `hidesMember` — no new `hidesChild` was needed. "+N more" under the
  column shows them all (editors). WIP counts every card. No default limit (deviation from "50 by
  default": existing boards would suddenly hide cards).
- **Not personal** (deviation from decision 2 for grouping): `groupBy` / `subGroupBy` decide where
  the real cards stand on the shared canvas, so they are saved for everyone by editors; per-person
  regrouping needs a projection (focus mode, 3a).
- **Outline**: a kanban reads `grouped by: <field> · rows: <field>`; person columns by name; a
  limited column `shows: N`; cards carry the stored Stage and row values by name. `update_items`
  refuses `fields` for the grouped field (move with `into` + `column`).
- **Rollout**: clients from before 2a keep stacking by `columns` (now the grouped field's values);
  their drops are right by construction, they only miss the rows. A 2a client opened while a kanban
  is grouped by another field reads Stage as the columns and, if it edits the Fields panel, drops
  Stage's stored option list (cards keep their Stage values, which read as empty until the options
  are added again): an accepted risk for the short window 2a clients are live, noted here.
- **Not done** (later steps): `$status` / `$assignee` as group fields, row collapse and Alt+Shift
  row moves, "show all people" columns, server re-lay after an API value change (2e), placement into
  a swimlane cell (2e).

## Step 2d as built

- **One filter and sort** (`@freero/shared` `query.ts`): a value is read into a `QueryValue` (its
  kind — text, number, date, option, options, person, checkbox —, the typed value, its words, an
  option's rank) and `matchValue` / `compareValues` / `sortByValues` work on that. The free-form
  table's typed filter and sort (`features/table/lib/columns.ts`) now read their cells as
  QueryValues and go through it (same results as before: labels for selects, unreadable typed text
  is no value but not empty, empty cells last both ways); kanbans read cards with `cardQueryValue`
  (built-in and custom fields); the server's `query_cards` and `configure_view` use the same.
  Ops: `is`, `isNot`, `anyOf`, `noneOf`, `contains`, `notContains`, `gt` / `lt` (dates: after /
  before), `empty`, `notEmpty`, `checked`, `unchecked`, `isMe`.
- **A sorted or filtered board is shared geometry, so sorting and filtering never depend on what
  one client knows**: text compares in one fixed collation (`'en'`, numeric), a timestamp reads as
  its UTC day, a person sorts by user id (names aren't known everywhere and change), and a saved
  filter can't say `isMe` (it would mean someone else on each client; `cleanFilter` drops it, the
  API refuses it). `withinDays` (design) is left out for the same reason: "today" differs by clock
  and time zone.
- **Filter shape** (deviation): one level, `{ op: 'and' | 'or', rules: [{ field, op, value }] }`, no
  nested groups. A fixed-depth shape keeps the MCP schema free of recursion and `$ref`; nesting can
  be added later as a second fixed level.
- **The saved filter** (`ViewConfig.filter`, saved for everyone like the rest of the view) hides the
  cards it leaves out: the layout (`planKanban`) stacks only the cards that pass and puts the others
  in their column below the board, after any beyond the card limit; the existing engine hook
  `hidesMember` folds them away (`filteredOut`, evaluated per card, so a card whose value changed
  remotely hides at once even before a local re-lay). They stay in their column, so WIP counts them
  and the outline lists them, marked `filtered: true`. Under the column (each swimlane cell) the
  board says "N hidden by filter"; the kanban's header shows "Filtered" (and "Sorted by …"), which
  opens the View panel.
- **"Filter for me" fades, it doesn't hide** (as section 5 proposed, now built): a person's own
  filter is part of their personal override (`ViewOverride.filter`, decision 2: theirs until an
  editor presses "Save for everyone", any role, kept through `Host.personalViews`). Hiding a card
  for one person would leave a hole in a stack everyone shares, or move cards under other people's
  cursors; so the card is drawn faded (`ChildPresentation.muted`, a new engine field: a look only,
  never sizes, hit-testing or the doc) and stays where it is, selectable. Nothing in the board doc
  changes, for anyone (tested: both clients' elements are byte-identical before and after). The
  personal filter replaces the saved one *for fading*: cards the saved filter hides stay hidden (the
  panel says so); saving makes it the saved filter, which then hides for everyone.
- **Sort** (`ViewConfig.sort`, up to three fields, each a tie-breaker): saved for everyone by
  editors, not personal (deviation from decision 2, as grouping in 2c: it moves the real cards).
  Each column (each cell) orders its cards by it, manual order breaking ties; dragging within a
  sorted column snaps back (keyboard ↑ / ↓ is off), moving between columns still works.
  **Manual order survives**: starting a sort keeps the items' manual order in the view
  (`manualOrder`, ids column by column, at most 5,000); clearing it lets the layout put every card
  back in that order (cards added while sorted go after, in their sorted order), after which the
  layout drops `manualOrder` itself — one undo step with the clear. Tested: positions come back
  exactly.
- **View lock** (`ViewConfig.locked = { by }`): an editor locks the saved view; then only whoever
  locked it and the board's owners change it (grouping, swimlanes, sort, density, WIP / collapse /
  card limits, "Save for everyone"); everyone keeps their own view settings (fields shown, colour,
  their filter). Distinct from locking the kanban element, which still locks schema and view. The
  lock is enforced by every client and by `configure_view`; like the rest of the doc it is not a
  security boundary against a modified client.
- **View panel**: Filter (rules: field, rule, value; all / any), Sort (fields, ascending /
  descending, "Back to manual order"), "Lock this view" / "Locked by Ann". Commands
  `kanban.setMyFilter`, `kanban.setSort`, `kanban.lockView`.
- **Rollout**: a 2c client ignores the view's filter and sort: its local re-lay stacks every card by
  position (unparking filtered ones); new clients still hide them by value (`hidesMember`), so for a
  moment there are holes until a new client lays the board out again. Accepted for the short window
  old clients are live.

## Step 2e as built

- **The layout moved into `@freero/shared`** (`layout/kanban.ts`: `planKanban`, `planGroupBy`,
  `reflowMoves`, `isStackable`, `storedKey`, `groupKeys`, `laneField`, `filteredOut`,
  `beyondLimit`, `manualOrderOf`), as 2a planned for the first server writer that needs it. The
  kanban feature's `arrange` and `setGroupBy` are thin wrappers. `withKanbanLayout(before, change)`
  lays out every kanban a server change touches as the feature's `arrange` would after the same
  change made locally, and merges the layout's patches into the change: a card whose grouped or
  swimlane value changed moves to its column / row, a placed card takes its row's value and its
  column's status, a card the filter now leaves out folds away, sorted columns stay sorted. Used by
  `update_items`, structure placement (`add_cards`, moves `into` a kanban) and the new kanban
  operations. Kanbans the change itself creates are laid out by whoever made them.
- **`update_items` `fields` for the grouped field** (2a refused it): a value of the field the board
  is grouped by moves the card to that column (positional, like card details' `kanban.moveToColumn`;
  a person without a column gets one), then the layout stacks it there with the column's status.
- **`add_cards` with `fields`** (card items carry them as `ItemInput.fields`, kept on the laid-out
  structure as `fieldsOf` until placement reads them against the kanban's schema with the shared
  `readFieldInputs`; refused anywhere but into a kanban, and for a new kanban, which has no fields
  yet). A value of the grouped field picks the card's column, of the swimlane field its row.
  `placement.row` (by title or id; also `into: "<kanbanId>:<columnId>:<rowId>"`) names a swimlane
  cell; without it a card goes to the row of its value, else the first ("No <field>").
- **`define_fields`** (MCP; REST `PATCH /boards/{b}/kanbans/{k}/fields`): add / rename / reorder /
  delete fields and options in one change, by id or by name / label. The grouped field's options are
  `columns`: adding, renaming, recolouring, reordering one edits the column, deleting moves its cards
  to the column beside it (`reflowMoves`, then the layout sets their status). The column field
  ("Stage"), the grouped field and the swimlane field can't be deleted. **Not built**: changing a
  field's type (the design's "retype with conversion") is refused — add a new field instead.
- **`configure_view`** (MCP; REST `PATCH /boards/{b}/kanbans/{k}/view`): groupBy (`planGroupBy`,
  the same transaction the View panel makes), subGroupBy, show, colour, density, filter, sort,
  per-column wip / limit / collapsed, locked. What an agent sets is the **saved** view (an API
  caller has no personal view; it acts like an editor pressing "Save for everyone"). Refused while
  the kanban is locked or the view is locked by someone other than the caller (board owners may).
  Deviation: one board view per kanban, so `PATCH …/view` instead of the design's
  `/views/{viewId}` CRUD (tabs are 3a).
- **`query_cards`** (MCP; REST `GET /boards/{b}/kanbans/{k}/cards`, `filter` as JSON, `sort` as
  `Points:desc,Title`): rows `{ id, title, column, row?, filtered?, fields: { name: value } }` —
  labels, people by name (only people the board shows, as the outline), ISO dates —, filtered and
  sorted by the shared rules, default order the board's own, `limit` ≤ 500 and `cursor`,
  `useView: true` applies the saved filter and sort first, `isMe` = the person the agent acts for.
  A read of the board: the downloads policy applies. `GET /boards/{b}/kanbans/{k}` returns the
  kanban's fields, columns, rows and saved view (also what the two write tools answer).
- **MCP schemas** are fixed-depth (the filter is one level), every parameter typed, no `$ref`
  (mcp.test.ts guards it for all tools).
- **Outline**: a kanban reads `filter: Priority is P1 and Points > 3`, `sort: Points (descending)`
  and `view locked: true`; a card the filter leaves out reads `filtered: true` (docs/board-outline.md).
- **Not done** (later): a REST batch `PATCH …/cards` (update_items covers it), `add_view` and view
  tabs (3a / 3c), field retyping, the `$status` / `$assignee` group fields, a server-side test of the
  view lock by a second editor (the client test covers the rule; the server check is one line in
  `planConfigureView`). (Server re-lay after a tracker pull: done when 2f joined, below.)

## Step 2f as built

Fields from the outside world: trackers, templates and CSV.

- **`@freero/shared` `fieldText.ts`** (new file, so 2d's move of the table's typed logic into
  `fields.ts` doesn't collide with it): words → values (`fieldValueFromText`: select / multi-select
  by label, case and spaces ignored; dates ISO or day/month/year, day-first unless the first number
  can only be a month; numbers with thousands separators; TRUE / FALSE, yes / no, x, ✓; people only
  through a caller's member lookup), values → words for CSV (`fieldValueToText`: labels, `; ` for
  several, names, ISO dates, TRUE / FALSE), `inferFieldType` (checkbox, number, date, link, a single
  select when few short labels repeat — at most 12 distinct and at most 60% of the cells —, a
  multi-select when cells list such labels with `;`, else text; person never guessed),
  `withOptions`, `rankColor` (most pressing first: red → gray), `priorityFieldOf` (the single select
  called "Priority"). The table's parse / infer now goes through it too (see "2d, 2e and 2f
  together" below).
- **Trackers** (`modules/trackers/kanban.ts`, pure). Status → Stage, one rule for import and pull:
  the option whose label is the tracker's status name, else the first option mapped to its category
  (`status`), else — on import only — a new column named after it, mapped to its category and
  placed with it (before Done for work in progress). That is 2c's "a value without a column gets its
  column" (as a person without one does); a pull never adds columns. While the board is grouped by
  another field Stage is stored and the same rule sets it (no option: no value), and the card goes
  to the column of the grouped field (Priority, or "No …"). A new kanban (`placement.newKanban`)
  gets the issues' statuses as columns, in category order. Priority: `IssueValues.priority` (Jira
  `fields.priority.name`; Linear's 1–4 scale by name; GitHub has none) ↔ the kanban's Priority
  field by label; an import into a kanban without one makes it, with the tracker's levels as options
  (`TrackerProvider.priorities`: Jira `GET /priority`, Linear's fixed scale; else the levels the
  issues have) and shows it first on the cards; a level the field lacks is added on import and on
  pull. **Sync back**: `ISSUE_FIELDS` gains `statusName` (the label of the card's column) and
  `priority`; they merge like every other field (`mergeField`, against the base), so moving a card
  from "Doing" to "In review" — same category — is a push of the status by name: Jira transitions to
  the status of that name, Linear sets the team's state of that name, each falling back to the
  category; a column the tracker has no status for sends only its category, silently (no note on
  every move between board-only columns). Links made before 2f have no base for the new fields, so
  they start syncing them after their next sync. `placeLaid` (structure) takes `columnFor` and
  `newKanbanColumns` for this; a `placement.column` the request names keeps the old rule.
- **Deviation: labels, assignee and due date are the card's own fields**, not new custom fields.
  They already sync both ways as `$tags` (a multi-select over the board's tags), `$assignee` (a
  person field, matched to members by verified email) and `$due`; a second "Labels" / "Owner" /
  "Due" field would hold the same data twice, and two-way sync would then have two board values for
  one tracker field. The kanban shows them through `card.show`. A per-connection field map for other
  custom fields (#43) is still later.
- **UI**: "Import issues into this kanban…" (a selected kanban's context menu) imports with
  `placement.into`; the send preview lists the column a card will ask for and its priority. MCP and
  REST already take `placement.into` / `newKanban`, so `import_from_tracker` gets all of this with
  no schema change (2e owns the tool schemas).
- **Templates**: the Kit's `kanban(…, typed)` and the spec archetype's `typed: { fields, show,
  colorBy }` (fields by name and type, options as labels, `ranked` for priority-like colours; cards'
  `values` by field name, `due`) write `fields`, a board view (`card.show`, colour-by) and each
  card's `values` (option ids). The template gate's `fieldProblems` checks, on every built template,
  hand-coded or spec: field names (unique, not a built-in's), at most 12 fields and 20 options, no
  empty select, cards showing / coloured by fields the kanban has, and every value one its field can
  hold on a stored field (never the column field: a card's Stage is its column). Seven templates use
  real fields now instead of text conventions: Sprint board (Priority, Points, Area), Bug triage
  (Severity — cards coloured by it —, Area), Customer feedback (Teams asking, Area), Support triage
  (Priority, Customer, Users affected), Sales pipeline review (Deal size, Next step), Postmortem
  action tracker (Incident, Kind) and Backlog refinement (Points, Criteria agreed). Owners and due
  dates are the cards' own assignee and due date (shown on the cards); a template can't name people.
  There is no kanban "content calendar" in the catalog (it is a journey layout), so none was changed.
- **CSV**: export adds a column per field of the kanban each card is in (Stage too; by field name,
  `" (field)"` when the name is one of Freero's own columns), values as `fieldValueToText` writes
  them. Import "Kanban" with a "Columns from" column (guessed from Stage / Column / Phase / List /
  Lane / Status / State headers) makes a NEW kanban: a column per distinct value (in the order they
  come; rows without one in "No stage"), the Stage field named after that header, and every other
  column not mapped to a card's own field a field of its inferred type (changeable per column in the
  dialog, or left out), selects with their distinct labels as options; cards get their values, in
  one undo step. Without a "Columns from" column it is the old kanban by status. **Not done**:
  importing a CSV into an *existing* kanban (it would add fields to a kanban another feature owns:
  it needs a kanban command that merges fields and places cards by value, and is a natural part of
  2e's `define_fields` / server re-lay).
- **Tests** (each fails without its change): a tracker's "In review" lands in the In review
  column, not the first of its category; an import lands by name / category / a new column and
  makes Priority once from the tracker's levels; a card moved to In review with another priority
  merges as a push of both and Jira gets the named transition and priority; a pulled level the field
  lacks is added and set; every template's values fit its fields; the gate names a bad option, an
  unreadable date, a missing field and a shown field the kanban lacks; a board made from Bug triage
  shows Severity / Area chips and colours by severity (real features); a kanban exported to CSV and
  imported back has its columns, fields and types (free text stays text) and every value;
  `npm run verify -- --only tracker` imports into a kanban from the mock Jira and moves a card back
  to Jira by name.

## 2d, 2e and 2f together

2f was built alongside 2d / 2e and merged with them; where they met:

- **One reading of words, one filter and sort.** `fieldText.ts` (2f) reads words as values and
  guesses a column's type; `query.ts` (2d) filters and sorts values. The free-form table no longer
  has its own number / date / checkbox parsing or type guess: `features/table/lib/columns.ts` asks
  `fieldText.ts` (with `dayFirst: false`, since a table keeps "03/04/2026" as typed rather than
  guess, and `choices: false`, since it never guesses selects or links) and `query.ts` reads numbers
  through it. The two sets of yes / no words became one (1 / 0, done, - included), and a column's
  type is now tried as a number before a checkbox, so a column of 1s and 0s stays numbers.
- **Placement** keeps both: a column a tracker import chose for a card (by status name, 2f's
  `columnFor`) wins, then a `placement.column` the caller named, then the card's value for the
  grouped field (2e), then its status; rows (2e) apply on top.
- **Trackers lay kanbans out** with `withKanbanLayout`: a pull (`planPull`) and an import into a
  kanban that was there (`trackers/kanban.ts` `importIntoKanban`) re-lay it in the same change, so
  a pulled Priority moves a card into that swimlane, and the view's filter and sort apply to what
  comes in. Found while joining them: a status column an import opens *between* others (2f puts "In
  progress" before Done) shifted the columns after it without moving their cards, so a card in Done
  then stood in the new column — a re-lay would have written that column's status onto it. The
  import now carries the cards along with their columns (`reflowMoves`), as the column menu does.
- **CSV into an existing kanban: still not done.** `define_fields` (2e) is a server operation over
  a board view; the CSV import runs in the browser, and adding fields to a kanban there is the
  kanban feature's write (a feature can't write another's element): it needs a kanban command that
  merges fields by name and type (options by label) and places cards by value into columns and
  rows, plus the dialog's "into this kanban" mapping. Not small; left for a later step.

## Step 3a as built

View tabs, the Table projection and focus mode.

- **Tabs** (`@freero/shared` `tabs.ts`): `views[]` holds the board view (views.ts, unchanged) and
  any number of **table views** (`TableViewConfig`: `id`, `name`, `layout: 'table'`, `columns` —
  fields after the title —, `filter`, `sort`, `locked`); `activeView` is the tab everyone starts on.
  `viewTabs(k)` reads them read-time and deterministically: one Board tab always (the board view
  `boardView` lays the cards out by; first when none is stored), then the tables; malformed entries
  are skipped. A kanban from before tabs has one tab, "Board", and nothing is written until someone
  adds a tab (which writes the synthesised board view out first, so the board reads the same). One
  board tab per kanban: it is the tab whose layout places the real cards, and a second board view
  would mean re-stacking every card on a tab switch.
- **The tab I look at is mine (decision 2)**: switching tabs is personal view state (key `_tab`
  under the kanban, any role, never in the doc). "Save for everyone" (View panel, editors) saves
  the tab I look at — its own changes (the board's fields shown and colour, or a table's columns,
  filter and sort) — and makes it `activeView`, in one undo step, and clears my overrides. Picking
  the saved tab clears my choice, so I follow the saved tab again. Adding, renaming and deleting
  tabs are saved changes (editors, an unlocked kanban, a tab not locked by someone else); deleting
  the tab someone looks at sends them back to the saved tab. **Deviation** from §3 "the active tab
  is shared": decision 2 replaced it, and this is that decision's shape for tabs.
- **Cards are hidden while I look at a table** (as §3 says), for me alone: the engine's
  `hidesMember` now gets the viewer's editor (`hidesMember(k, el, { editor })`) and is asked again
  when personal view state changes (EditorEvent `'personal-views'`, which also prunes the
  selection). They stay in the doc, in their columns and in the outline; the board keeps laying
  them out, so switching back is instant. The kanban's box keeps the board's size (it is shared
  geometry and the tab is personal); the table is drawn inside it and scrolls there. **Deviation**
  from §8's `hidesChild`: the existing `hidesMember` hook covers it with the added argument.
- **Table tab on the canvas** (`lib/TableTab.tsx`, `lib/Grid.tsx`): the kanban's cards as rows —
  every card, folded-away ones too —, the title then the tab's columns (default: the kanban's
  fields, assignee, due date), in the board's order (column by column, top to bottom) unless
  sorted. Its filter and sort are the shared `query.ts` ones and really leave rows out / order them
  (a projection moves no shared geometry); mine until saved. Every cell has a typed editor (text,
  number, date, link: an input; select, multi-select, person — the board's members —, status,
  tags: a menu of options with their colours; checkbox: toggles), and every edit is one
  `card.setValues` (one undo step, live for everyone; a new value for the grouped field moves the
  real card, as card details do). The grid is a real `role="grid"`: arrows, Home / End, Page Up /
  Down, Enter / F2 / a click on the active cell to edit, Tab / Enter / Escape in an editor. It takes
  pointer, wheel and keys only while the kanban is selected (`data-fr-interactive`,
  `data-fr-scrollable`, `data-fr-keyboard-trap`). **Windowed**: rows are drawn only where the box's
  own scroll and the window (`useWorldViewport`, a new engine hook: the visible world rect snapped
  to an eighth of the view) overlap, so a 5,000-card table costs the rows on screen. The View panel
  on a table tab: filter, sort, columns (toggle, reorder), "Save for everyone" / "Reset".
- **Focus mode** (`lib/Focus.tsx`, dialog panel `kanban.focus`; the header's ⤢ button, "Open in
  focus mode" in the context menu and a tab's menu): the kanban as a page (`Modal` gained
  `size="page"` and `escapeToContent`). Arranged by me alone (personal key `_focus`, follows me to
  other devices): group by any single select, person or checkbox field **and the card's own status
  or assignee** (a projection may), compact or comfortable rows (comfortable shows a description
  line), my filter, my sort, which fields are columns, "As on the board" to drop all of it. It
  starts from the board: grouped as the board is, its saved filter and sort. The same grid, so the
  same keyboard path and screen-reader labels (`aria-rowcount` while windowed, group header rows,
  the title as each row's header, "Checked" / "Not checked" in check cells). **On phones** (the
  ≤ 600 px layout while viewing, not editing) tapping a kanban opens it here; its groups are a row
  of chips and a horizontal swipe on the list moves to the next or previous group. A column's
  "+N more" opens it for people who can't show every card on the board (viewers, commenters, a
  locked kanban). **Per-person grouping and density** — kept shared on the canvas by 2b / 2c —
  live here. **Not built**: "Save to view" from focus mode (its grouping and density can't become
  the board's without moving the real cards; the View panel saves what can be saved), a separate
  list layout (comfortable rows and fewer columns on phones stand in), bottom-sheet card details
  (cells edit in place), long-press "Move to ▸" (the grouped field's cell does it).
- **Agents**: `configure_view` takes `view` (a tab by name or id; default the Board), `addView`
  (`{ name, layout: "table" }`; the rest of the call configures the new tab), `name`, `active: true`
  and `remove: true`; a table tab takes `show` (its columns), `filter`, `sort` and `locked`, and
  refuses what moves cards (that belongs to the Board tab). `query_cards` takes `view` (that tab's
  filter and sort apply first). The kanban summary (`GET …/kanbans/{id}`, both tools' answers)
  lists `views` with ids, layouts, `active` and a table's settings. The outline reads
  `views: Board, Hot list* (table)` once a kanban has more than its board. MCP schemas stay
  fixed-depth with no `$ref` (mcp.test.ts). **Deviation**: REST keeps `PATCH …/view` (same body)
  rather than `POST / PATCH / DELETE …/views/{viewId}`: one endpoint, as the tool is one.
- **Rollout** (as for 2c / 2d): clients from 2b to 2f read only the board view —
  `storedBoardView` takes the active view when it is a board, else the first board view — so when
  everyone starts on a table they show the board, cards in place; they write the board view with
  `savedViews`, which keeps every other entry and `activeView` (tested: regrouping while everyone
  starts on a table keeps the tab and keeps them on it). They never hide cards and know nothing of
  personal tabs. Clients from before 2b ignore `views`. Table views carry only ids and filter
  values, like the board view. The server switched in the same release. The new personal keys
  (`_tab`, `_focus`, a table tab's id) count toward the 200 personal settings per board.
- **Performance**: opening focus mode on 5,000 cards takes ~35 ms in tests (rows windowed; the
  rows are recomputed when the kanban's cards change, not on unrelated edits). Found while testing:
  creating cards *inside* a kanban grows faster than linearly (2,000 in one transaction ~2.5 s,
  5,000 ~16 s in the test harness; outside a kanban 2,000 take 0.2 s). That predates 3a (the same
  without the new fold) and matters for big imports; it belongs with the benchmark script §18 asks
  for, still not written.
- **Tests** (each fails without its change): a table tab folds the cards away for its viewer only —
  out of their selection, the collaborator keeps them, nobody's doc changes — and deleting the tab
  brings them back; Save for everyone on a table tab makes it everyone's tab with its sort, and the
  collaborator on the saved Board moves to it; regrouping while everyone starts on a table keeps the
  tab (the older clients' write path); in focus mode, arrow keys walk to a cell, Enter / typing /
  Enter write it for everyone in one undo step, and picking Done for Stage moves the real card;
  grouping by Priority in focus mode is mine (the collaborator's focus mode and every doc
  unchanged); 1,000 cards open with fewer than 50 rows drawn and the right `aria-rowcount`; an
  agent adds a sorted, filtered table tab without moving a card, the outline lists the tabs,
  query_cards with that view reads its rows in its order, and the Board tab can't be deleted.

Left for 3b / 3c: list, calendar and timeline layouts (`ViewTab.layout` widens; 3a clients skip
tabs of layouts they don't know and keep them when they write), grouped sections and column widths
in a table tab (the design's `groupBy` / `table.columns[].w`), comment and "open details" from a
row, "Save to view" from focus mode where it can apply, linked views (`kanbanview`, 3c), the
5,000-card benchmark.

## Step 3b as built

List, Calendar and Timeline, as tabs on the canvas and as layouts of focus mode.

- **Model** (`@freero/shared` `tabs.ts`): `ViewTab.layout` is `board | table | list | calendar |
  timeline`. Every tab but the board is a *projection* (`ProjectionView`): `id`, `name`, `filter`,
  `sort`, `locked`, and per layout — a list `columns` (fields after the title; default what the
  board's cards show) and `groupBy` (absent: as the board; `null`: none; any single select, person
  or checkbox and the card's own **Status** and **Assignee**, which a projection may group by since
  it moves no card); a calendar `date` (`$due` by default, `$start` or a date field); a timeline
  `start` / `end` (`$start` / `$due` by default, or date fields), `scale` (the timeline element's
  day / week / month / quarter) and `lanesBy`. Field ids are only shape-checked when stored and read
  past when deleted (`calendarDateField`, `timelineFields`, `listGroupField`), as the board view
  reads past a deleted group field. A person's own changes to any of these are a personal override
  under the tab's id, as a table's (`LAYOUT_SETTINGS` says which keys each layout has); "Save for
  everyone" saves them with the tab (one undo step). The design's `ViewConfig` shape (`calendar: {
  date, end }`, `timeline: { start, end, scale, lanesBy }`) is flattened onto the tab, like 3a's
  table settings. **Not built**: a calendar span (`calendar.end`): a card sits on one day.
- **Placement** (`@freero/shared` `projections.ts`, pure): a calendar's days (`calendarDays`,
  `monthWeeks`, `monthStart`, Monday-first), a timeline bar (`barSpanOf`: both dates; one of them
  alone is a one-day bar; a start after the end reads from the earlier) and the range it draws
  (`timelineRange`: a week before the first bar or today to three weeks after the last, at most
  1,500 days). It sits on the timeline *element's* day arithmetic and axis (`timelineLayout`:
  `dayOf`, `isoOf`, `mondayOf`, `axisTicks`, `PX_PER_DAY`, `DEFAULT_DAYS`) so a "day" and a "week"
  mean the same in both. The timeline element itself is not used: its bars are separate elements
  laid out by `planTimeline`, while a tab draws the kanban's cards and moves nothing.
- **What a move writes** — always one `card.setValues` (the card feature's write path; one undo
  step, live for everyone): a calendar drop / key writes the date field (`calendarMoveValues`); a
  card has one start and one due date and `card.setValues` refuses a start after the due date, so
  a move that would invert them carries the other date along by the same days (the card keeps its
  length) instead of silently doing nothing. A timeline move writes both ends, a resize one end
  never past the other (`editBar`), and **both dates are always written** (`spanValues`), so a
  card with only a due date gains the start its one-day bar showed. Dragging a card into the
  calendar's "No date" aside clears the date; dragging one from the timeline's aside onto a row
  gives it `DEFAULT_DAYS[scale]` days from where it lands. No geometry is written: a projection
  never moves a real card (a list's group change of the board's column field moves it through
  `kanban.moveToColumn`, as card details do).
- **List** (`lib/ListView.tsx`): the 3a grid in a lighter dress (`is-list`: no cell rules, a wide
  title, chips) with group header rows — so the same keyboard walk, cell editors, screen-reader
  labels and windowing — plus **Alt+↑ / Alt+↓** on a row: the card to the group above / below
  (the field's groups in order: a select's options with "No <field>" first, unchecked / checked,
  people the list has), and the active cell follows the card. The design's "inline title edit" is
  the grid's title cell.
- **Calendar** (`lib/CalendarView.tsx`): a month (or week) grid, Monday first, prev / next / Today,
  the undated cards aside ("No due date", windowed). A day shows the cards that fit and "+N more"
  (a windowed popover); in a week a day's cards scroll. Dragging (mouse, pen) lights the day under
  the pointer; touch taps a card for its dates. Keys: the days are a `role="grid"` (arrows walk
  days, Page Up / Down months, Home / End the week, Enter into the day's cards, ↑ / ↓ between them,
  Escape back); on a card **Alt + ← / →** moves it a day, **Alt + ↑ / ↓** a week (focus follows it),
  Enter opens the **dates popover** (a date input, Save, "No date"). Labels: "Fix login, Due date:
  Tuesday, November 4, 2026" with the keys as its description; a day "Tuesday, …, today: 3 cards".
- **Timeline** (`lib/TimelineView.tsx`): a row per dated card (by start unless sorted) with its
  title held at the left, the axis of the timeline element (two header rows, the today line),
  swimlanes as header rows, the undated cards aside. Dragging a bar moves it, its ends resize it
  (screen pixels per day measured on the track, so it works at any canvas zoom); a short bar says
  its title beside it. Keys: ↑ / ↓ walk the bars, Home / End; **Alt + ← / →** moves a bar a day,
  **Alt + Shift + ← / →** moves its end; Enter opens the dates popover (start and end). Windowed
  both ways: the rows in view (and, on the canvas, in the window: `useWorldViewport`), the axis
  labels in view.
- **On the canvas** (`lib/ProjectionTab.tsx`): any tab but the board draws inside the kanban's box
  (the box keeps the board's size), takes pointer, wheel and keys only while the kanban is selected
  (`data-fr-interactive`, `-scrollable`, `-keyboard-trap`), and folds the cards away for its viewer
  alone (`hidesMember`: the viewer's tab is not the board — 3a asked "is it a table"). "+ View" (was
  "+ Table") offers the four layouts; the tab menu deletes any but the board. The View panel shows
  each layout's settings (date field; start, end, scale, swimlanes; groups; columns) above filter
  and sort.
- **Focus mode**: a layout switch (Table, List, Calendar, Timeline) with each layout's settings,
  all personal (`_focus`). It opens the way the tab I look at shows the cards (its layout and
  settings; "As in <tab>" resets to it), else as a table — **on phones as a list** (the 3a grid
  stood in for one). On phones the calendar is the week as an agenda (days one under another, big
  tap targets, the undated cards below), the timeline a narrow label column and a tap for dates.
  **Not built**: horizontal swipe between calendar weeks (the arrows do it).
- **Agents**: `configure_view` `addView.layout` takes `list`, `calendar`, `timeline` with their
  settings in the same call: `show` and `groupBy` (nullable now: a list without groups) on a list,
  `date` on a calendar, `start`, `end`, `scale` and `subGroupBy` (its swimlanes, the name the board
  uses) on a timeline, by field name; a setting of another layout is refused naming what the tab
  takes, a field that isn't a date with the date fields named. The kanban summary's `views` carry
  each tab's settings by name. `query_cards` with `view` applies any tab's filter and sort, and a
  calendar's or timeline's cards come in date order unless it is sorted (undated last). The outline
  reads `views: Board*, Launches (calendar by Launch), Plan (timeline from Start date to Due date in
  lanes by Team)`. **Addition**: `update_items` takes a card's `startDate` (refused after its due
  date) — without it an agent could not place a bar's start. MCP schemas stay fixed-depth, no
  `$ref` (mcp.test.ts); OpenAPI, the Power Automate connector, docs/mcp.md, the API README and the
  outline doc updated.
- **Rollout**: 3a clients skip tabs of the new layouts (`cleanTableView` takes tables only) and keep
  them when they write; while everyone starts on a calendar they start on the Board, cards in
  place. But a 3a client writes `activeView: savedTabId(k)`, which for it is the board, whenever it
  adds, renames, saves or deletes a *table* tab: an editor on a stale 3a tab doing that while
  everyone starts on a calendar moves everyone back to the Board (nothing is lost; "Save for
  everyone" puts it back). 3b's writers keep an `activeView` naming a stored entry of any layout
  (`keptActive`), so the next layout won't have this problem with 3b clients. Clients from 2b to 2f
  read only the board view (as before). A 3a client's tab limit counts only the tabs it knows. New
  personal keys: none (the tabs' ids, as 3a).
- **Performance**: 1,000 dated cards open in focus mode's timeline with fewer than 60 bars drawn
  and a calendar day of 1,000 cards shows a few and "+N more", in tests. A calendar month draws at
  most its 42 days times what fits; the undated asides and the "+N more" popover are windowed.
  Grouping and placement are recomputed when the kanban's cards change, not on unrelated edits.
- **Tests** (each fails without its change, checked by mutation): in the calendar Alt+→ moves a
  due date a day for everyone in one undo step and a move before the start carries the start along;
  on the timeline Alt+Shift+→ moves only the end and Alt+→ both, each one undo step, and a
  due-only card gains its start; in a list grouped by Stage Alt+↓ moves the real card into Doing in
  one undo step; 1,000 dated cards draw only what is on screen (timeline and calendar); adding a
  calendar tab while everyone starts on a newer client's tab keeps them on it and its entry, and
  looking at the calendar folds the cards away for its viewer alone; an agent adds a calendar on a
  date field and a timeline with swimlanes without moving a card, the outline says what places
  their cards, `query_cards` reads the calendar in date order and the timeline with the start set
  by `update_items`, and a non-date field is refused.

Left: a calendar span (`calendar.end`), linked views (3c), dependencies drawn on a timeline tab,
grouped sections and column widths in a table tab, "Save to view" from focus mode, the 5,000-card
benchmark (another agent).

## Step 3e as built

Table ↔ kanban (decision 4: the free-form table stays a separate sheet). Closes most of #51 ("pin
a row as a card" is answered by converting; the table's own timeline / grouped grid / several
filters stay open there).

- **"Convert to kanban…"** (a selected table's context menu, editors, not on a locked table): a
  dialog picks **Columns from** (any column; the board view's group column, else the first select
  column, else a text column of a few repeating labels is offered first) and **Card titles from**
  (the first other text column), and lists what every other column becomes. Columns: a select's
  options in their order (colours kept), then values it doesn't list, and a "No <column>" column
  first when some rows have none; other column types give a column per distinct value as read
  (people by name, numbers and dates as shown), in the order they come; more than 40 is refused
  with the reason. Column titles that name a status ("Done", "In progress") set their cards'
  status, as everywhere kanbans are made. Each row that holds anything becomes a card, titled
  from the title column.
- **Field types**: a typed column keeps its type (number, date, person, checkbox; a select with its
  options, the table's tint mapped to the same hue of the option palette); a text column's type is
  read from its words by `fieldText.ts` `inferFieldType` (with the table's `dayFirst: false`), so
  a column of a few repeating labels becomes a single select, "a; b" lists a multi-select, links a
  URL field. **Deviation**: a typed column holding text it can't read (the table keeps such text
  rather than lose it) becomes a *text* field, so nothing typed is lost; one cell alone never
  infers a select or link. A column named like a card's own field fills that field when its values
  fit — Description, Assignee (a person column), Due date / Start date (a date column), Estimate,
  Link (links) —; any other such name ("Status", "Tags") stays a field, named "Status (field)".
- **One undo step, where the table was**: the kanban's top-left is the table's (and its frame, if
  any); the kanban and its cards are created and the table removed in one transaction. Undo brings
  the table back with every cell (cells are never deleted with the table; they wait under its id).
- **Ownership** (the precedent is `tags.applyNames` from the CSV import and `kanban.moveToColumn`
  from card details: a feature asks the owner through a command, inside its own transaction): the
  table reads its own cells and hands the rows, as words and values, to the kanban feature's new
  command **`kanban.createFromRows`** (`{ rows, at, id, frameId }`), which makes the kanban and its
  cards; the table only removes its own element. The rules — field definitions with option ids,
  values read with `readFieldInputs` (selects by label), the board view showing the short fields
  then assignee, due date and tags, colour by column, geometry from the shared kanban structure —
  are pure, in `@freero/shared` `layout/kanbanRows.ts` `layoutKanbanRows`, so a server writer can
  make the same kanban later. `table.convertToKanban` with `{ columnsFrom, titleFrom }` converts
  the selected table without the dialog.
- **"Copy as table"** (a selected kanban's context menu; the table feature's command
  `table.copyKanbanAsTable`, so the kanban side has no change): a new table on a free spot beside
  the kanban, a row per card in board order (column by column, swimlane by swimlane, top to
  bottom), columns Title, Description (when any card has one), every field in schema order (the
  column field and selects as select columns with their options, people as person columns,
  numbers, dates and checkboxes typed, multi-selects as "a; b" text), then the card's own
  assignee, due / start date, estimate, tags ("a; b") and link when any card has them; status is
  left out (the columns say it). A snapshot: nothing links it to the cards. One undo step; the
  kanban and its cards are only read (`collectionSchema`, `cardValue`, `builtinValue`).
- **Agents**: no MCP or REST change. An agent converts today with the tools it has (read the
  table in the outline, `add_cards` columns mode for the new kanban, `define_fields`,
  `update_items` with `fields`); `layoutKanbanRows` is the natural base if a one-call "rows to a
  kanban with fields" path is wanted later (it would also let `add_cards` make a *new* kanban with
  fields, which 2e refuses).
- **Tests** (app level, real features, each failing without its change): a table with typed and
  text columns converts where it stood — columns from the chosen column with "No Stage" first,
  types kept / inferred, "Status" kept as "Status (field)", "Due date" as the cards' due date, the
  empty row no card — and one undo restores the table and every cell (fails if the kanban and the
  removal are two steps); "Copy as table" gives a row per card in board order (a card moved up by
  hand comes first), typed columns, beside the kanban, which is left as it was.

## Sources (concepts only; nothing copied)

- Notion: [Views, filters, sorts & groups](https://notion.com/help/views-filters-and-sorts),
  [Board view](https://www.notion.com/en-gb/help/boards)
- Airtable: [Kanban views](https://support.airtable.com/docs/getting-started-with-airtable-kanban-views),
  [Collaborative, personal and locked views](https://support.airtable.com/docs/locked-views)
- Linear: [Display options](https://linear.app/docs/display-options)
- Miro (whiteboard with tables and kanban views):
  [help center](https://help.miro.com/hc/articles/22760922335506),
  [community thread on synced table views](https://community.miro.com/ask-the-community-45/tables-cards-and-syncing-issues-24311)

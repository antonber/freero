# Kanban phases 2 and 3: fields, group-by and views of the same data

Status: **proposal, not built**. Owner decisions are needed on the questions at the end before step
2a starts. Phase 1 (card colour follows column, smoother drag, keyboard moves, column reorder /
collapse / resize) is in progress in `features/kanban` and is assumed to have landed first.

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

## Open questions for the owner

1. **Dragging a card out of a kanban**: leaves the collection (proposed: today's behaviour,
   membership = containment), or stays a member wherever it goes on the board (Notion-like, needs a
   `collectionId` and "elsewhere" placeholders in columns)?
2. **The active view tab**: shared for everyone (proposed: one canvas, one picture; personal
   re-slicing in focus mode), or remembered per person?
3. **Cross-board views (3d)**: needed in this round, or are views on the same board plus focus mode
   enough for now?
4. **Tables**: keep the `table` element as a free-form sheet with "Convert to kanban" (proposed), or
   plan to replace its typed columns and board view with collections so there is one database model?

## Sources (concepts only; nothing copied)

- Notion: [Views, filters, sorts & groups](https://notion.com/help/views-filters-and-sorts),
  [Board view](https://www.notion.com/en-gb/help/boards)
- Airtable: [Kanban views](https://support.airtable.com/docs/getting-started-with-airtable-kanban-views),
  [Collaborative, personal and locked views](https://support.airtable.com/docs/locked-views)
- Linear: [Display options](https://linear.app/docs/display-options)
- Miro (whiteboard with tables and kanban views):
  [help center](https://help.miro.com/hc/articles/22760922335506),
  [community thread on synced table views](https://community.miro.com/ask-the-community-45/tables-cards-and-syncing-issues-24311)

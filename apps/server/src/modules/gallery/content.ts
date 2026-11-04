// What of a board may become a public template (#162). Pure: takes the board's SHARED document as
// JSON (realtime's backup content without layers — so private drafts and hidden frames' contents,
// which live in layers, never arrive here) and keeps only what a stranger may see:
//
// - Items: everything but hidden frames (and anything inside or attached to one, should the shared
//   doc hold it mid-move), items that point at things a stranger can't open — links to other boards
//   and docs, file attachments, embeds of other sites, live activities, icebreakers — and linked
//   views whose kanban isn't kept. Connectors to a dropped item go too.
// - On every kept item, nothing that names a person: who made it (and with which app), who
//   suggested it, who it is assigned to (and person-field values on cards), protected locks, issue
//   links. Installing sets the installer as creator.
// - Collections: only an item's own content whose items are all kept (table and chart cells), the
//   tag vocabulary, diagram sources of kept diagrams and the board's settings. Never comments,
//   votes, estimates, timers, presenter notes, activity results, tracker badges or anything else.
import { ELEMENT_CONTENT_COLLECTIONS, Y_SETTINGS } from '@freero/shared';
import type { GalleryContent } from './repo';

/** Item types left out: each points at something outside the board, or is live state of its own. */
const DROP_TYPES = new Set(['objectlink', 'doc', 'file', 'embed', 'activity', 'icebreaker']);
/** Fields of an item that name a person or point at server state the template doesn't have. */
const PERSON_FIELDS = ['createdBy', 'createdVia', 'suggestedBy', 'updatedBy', 'assigneeId', 'trackerLink', 'lockProtected'] as const;
/** Fields by which an item sits in, or hangs off, another one. */
const CONTAINER_FIELDS = ['frameId', 'attachedTo', 'parentId', 'kanbanId', 'containerId', 'diagramId', 'sourceId'] as const;
/** Collections an item's own content lives in, kept with the items. */
const ITEM_CONTENT = ['tableCells', 'chartCells'] as const;
/** Board-level collections a template carries as they are. */
const KEPT_AS_IS = ['tags', Y_SETTINGS] as const;

type El = Record<string, unknown>;
const isObj = (v: unknown): v is El => !!v && typeof v === 'object' && !Array.isArray(v);

function endIds(el: El): string[] {
  const out: string[] = [];
  for (const end of [el.start, el.end]) if (isObj(end) && typeof end.elementId === 'string') out.push(end.elementId);
  return out;
}

/** The ids of person fields on the board's kanbans (their values on cards are user ids). */
function personFields(elements: El[]): Set<string> {
  const out = new Set(['$assignee']);
  for (const el of elements)
    if (Array.isArray(el.fields)) for (const f of el.fields) if (isObj(f) && f.type === 'person' && typeof f.id === 'string') out.add(f.id);
  return out;
}

export interface CleanedContent {
  content: GalleryContent;
  /** Kept items, in the shared doc's order. */
  elements: El[];
}

export function galleryContentOf(doc: Record<string, Record<string, unknown>>): CleanedContent {
  const all = Object.values(doc.elements ?? {}).filter((v): v is El => isObj(v) && typeof v.id === 'string' && typeof v.type === 'string');
  const byId = new Map(all.map((el) => [el.id as string, el]));
  const dropped = new Set<string>();
  for (const el of all) if (DROP_TYPES.has(el.type as string) || (el.type === 'frame' && el.hidden === true)) dropped.add(el.id as string);
  // Whatever sits in, hangs off or joins a dropped item goes with it, at any depth.
  for (let grew = true; grew; ) {
    grew = false;
    for (const el of all) {
      const id = el.id as string;
      if (dropped.has(id)) continue;
      const refs = [...CONTAINER_FIELDS.map((f) => el[f]).filter((v): v is string => typeof v === 'string'), ...endIds(el)];
      // A linked view without its kanban shows nothing.
      const orphanView = el.type === 'kanbanview' && (typeof el.sourceId !== 'string' || !byId.has(el.sourceId));
      if (orphanView || refs.some((r) => dropped.has(r))) {
        dropped.add(id);
        grew = true;
      }
    }
  }
  const people = personFields(all);
  const kept: El[] = [];
  for (const el of all) {
    if (dropped.has(el.id as string)) continue;
    const copy: El = { ...el };
    for (const f of PERSON_FIELDS) delete copy[f];
    if (isObj(copy.values)) copy.values = Object.fromEntries(Object.entries(copy.values).filter(([k]) => !people.has(k)));
    kept.push(copy);
  }
  const keptIds = new Set(kept.map((el) => el.id as string));

  const content: GalleryContent = { elements: Object.fromEntries(kept.map((el) => [el.id as string, el])) };
  for (const name of ITEM_CONTENT) {
    const map = doc[name];
    if (!map) continue;
    const rule = ELEMENT_CONTENT_COLLECTIONS[name];
    const entries = Object.entries(map).filter(([key, value]) => {
      const owners = rule.owners(key, value, (k) => map[k]);
      return owners.length > 0 && owners.every((o) => keptIds.has(o));
    });
    if (entries.length) content[name] = Object.fromEntries(entries);
  }
  for (const name of KEPT_AS_IS) if (doc[name] && Object.keys(doc[name]).length) content[name] = { ...doc[name] };
  const sources = Object.entries(doc.diagramSources ?? {}).filter(([diagramId]) => keptIds.has(diagramId));
  if (sources.length) content.diagramSources = Object.fromEntries(sources);
  return { content, elements: kept };
}

/** The template's content as a new board's first state: the installer is the creator of every item. */
export function contentForInstall(content: GalleryContent, userId: string, now: number): GalleryContent {
  const elements = Object.fromEntries(Object.entries(content.elements ?? {}).map(([id, el]) => [id, { ...(el as El), createdBy: userId, createdAt: now, updatedAt: now }]));
  return { ...content, elements };
}

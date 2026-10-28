// Shape library: the sets of symbols the library panel offers. Which sets a board shows is
// board data (the `shapeLibraries` collection, owned by this feature): key = set id, value =
// boolean. Sets not mentioned use their `defaultOn`.
import type { ShapeKind } from '@freero/shared';
import { SHAPE_KINDS } from './constants';

export const LIBRARY_COLLECTION = 'shapeLibraries';

export interface LibraryShape {
  kind: ShapeKind;
  label: string;
  /** Extra search words. */
  keywords?: string;
  /** Natural insert size (world units). */
  w: number;
  h: number;
}

export type ShapeSetId = 'basic' | 'flowchart' | 'uml' | 'bpmn' | 'network';

export interface ShapeSet {
  id: ShapeSetId;
  label: string;
  description: string;
  defaultOn: boolean;
  shapes: LibraryShape[];
}

const S = (kind: ShapeKind, label: string, w = 120, h = 120, keywords?: string): LibraryShape => ({ kind, label, w, h, keywords });

export const SHAPE_SETS: ShapeSet[] = [
  {
    id: 'basic',
    label: 'Basic',
    description: 'Rectangles, circles, arrows, callouts',
    defaultOn: true,
    shapes: SHAPE_KINDS.map((s) => S(s.kind, s.label)),
  },
  {
    id: 'flowchart',
    label: 'Flowchart',
    description: 'Process maps and algorithms',
    defaultOn: true,
    shapes: [
      S('rect', 'Process', 160, 80, 'step action'),
      S('diamond', 'Decision', 140, 100, 'if branch condition'),
      S('terminator', 'Start / end', 160, 64, 'terminator terminal begin stop'),
      S('parallelogram', 'Data (input / output)', 160, 80, 'io'),
      S('document', 'Document', 160, 96, 'report'),
      S('multiDocument', 'Multiple documents', 160, 104, 'documents reports'),
      S('predefinedProcess', 'Predefined process', 160, 80, 'subroutine function'),
      S('manualInput', 'Manual input', 160, 80, 'keyboard entry'),
      S('manualOperation', 'Manual operation', 160, 80, 'manual task'),
      S('hexagon', 'Preparation', 160, 80, 'setup initialization'),
      S('delay', 'Delay', 140, 80, 'wait'),
      S('display', 'Display', 160, 80, 'screen output'),
      S('cylinder', 'Database', 100, 120, 'stored data disk'),
      S('storedData', 'Stored data', 150, 80, 'storage'),
      S('internalStorage', 'Internal storage', 120, 100, 'memory'),
      S('ellipse', 'On-page reference', 64, 64, 'connector circle'),
      S('offPageRef', 'Off-page reference', 80, 80, 'connector page link'),
      S('merge', 'Merge', 100, 80, 'combine triangle'),
      S('triangle', 'Extract', 100, 80, 'split'),
      S('collate', 'Collate', 80, 100, 'hourglass'),
      S('sort', 'Sort', 120, 100, 'order'),
      S('loopLimit', 'Loop limit', 160, 80, 'loop repeat'),
      S('punchedCard', 'Card', 140, 90, 'punched card'),
      S('punchedTape', 'Paper tape', 160, 90, 'punched tape'),
      S('summingJunction', 'Summing junction', 64, 64, 'and'),
      S('orJunction', 'Or', 64, 64, 'junction'),
    ],
  },
  {
    id: 'uml',
    label: 'UML',
    description: 'Classes, actors, packages, components',
    defaultOn: false,
    shapes: [
      S('umlClass', 'Class', 180, 140, 'object attributes methods'),
      S('umlActor', 'Actor', 70, 130, 'user person stick figure'),
      S('ellipse', 'Use case', 180, 90, 'oval'),
      S('umlPackage', 'Package', 180, 120, 'folder namespace module'),
      S('umlNote', 'Note', 160, 100, 'comment'),
      S('umlComponent', 'Component', 180, 110, 'module'),
      S('umlNode', 'Node', 180, 120, 'device deployment box'),
      S('roundRect', 'State', 160, 80, 'activity'),
    ],
  },
  {
    id: 'bpmn',
    label: 'BPMN',
    description: 'Tasks, events, gateways (lite)',
    defaultOn: false,
    shapes: [
      S('roundRect', 'Task', 160, 90, 'activity'),
      S('bpmnSubprocess', 'Subprocess', 180, 110, 'collapsed'),
      S('ellipse', 'Start event', 56, 56, 'begin'),
      S('bpmnIntermediate', 'Intermediate event', 56, 56, 'catch throw'),
      S('bpmnEnd', 'End event', 56, 56, 'finish stop'),
      S('diamond', 'Gateway', 72, 72, 'decision'),
      S('bpmnGatewayX', 'Exclusive gateway', 72, 72, 'xor'),
      S('bpmnGatewayPlus', 'Parallel gateway', 72, 72, 'and fork join'),
      S('bpmnGatewayO', 'Inclusive gateway', 72, 72, 'or'),
      S('umlNote', 'Data object', 64, 84, 'document file'),
      S('cylinder', 'Data store', 84, 84, 'database'),
    ],
  },
  {
    id: 'network',
    label: 'Network',
    description: 'Servers, devices, users',
    defaultOn: false,
    shapes: [
      S('netServer', 'Server', 100, 120, 'rack host'),
      S('cylinder', 'Database', 90, 110, 'storage db'),
      S('cloud', 'Cloud', 160, 100, 'internet'),
      S('netFirewall', 'Firewall', 110, 90, 'wall security'),
      S('netRouter', 'Router', 100, 100, 'gateway'),
      S('netSwitch', 'Switch', 140, 70, 'hub'),
      S('netMonitor', 'Desktop', 120, 110, 'computer pc screen'),
      S('netLaptop', 'Laptop', 140, 100, 'notebook computer'),
      S('netPhone', 'Phone', 64, 110, 'mobile tablet'),
      S('netUser', 'User', 90, 110, 'person client'),
    ],
  },
];

/** Every kind any set uses, once (tests iterate it). */
export const LIBRARY_KINDS: ShapeKind[] = [...new Set(SHAPE_SETS.flatMap((s) => s.shapes.map((x) => x.kind)))];

/** Which sets are on for this board: explicit choices win, otherwise the set's default. */
export function enabledSets(choices: Iterable<[string, boolean]>): ShapeSet[] {
  const map = new Map(choices);
  return SHAPE_SETS.filter((s) => map.get(s.id) ?? s.defaultOn);
}

/** Shapes of the given sets matching every word of `query` (label, keywords or set name). */
export function searchShapes(sets: ShapeSet[], query: string): Array<{ set: ShapeSet; shapes: LibraryShape[] }> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return sets
    .map((set) => ({
      set,
      shapes: set.shapes.filter((s) => {
        const hay = `${s.label} ${s.keywords ?? ''} ${set.label}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      }),
    }))
    .filter((g) => g.shapes.length > 0);
}

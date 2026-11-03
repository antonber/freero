// PlantUML as diagrams as code (#38): what lands on the board from the documented syntax of each
// diagram kind, and what is refused.
import { afterEach, expect, it } from 'vitest';
import { parsePlantUml, richTextToPlain, type ConnectorElement, type FrameElement, type PlantUmlDiagram, type ShapeElement } from '@freero/shared';
import { createTestBoard, type TestBoard } from '@engine';
import commands from './commands';
import manifest from './feature';
import { DIAGRAMS, insertLaid, layoutText } from './lib/insert';
import { detectKind } from './lib/parse';

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
});
const open = () => {
  board = createTestBoard({ users: ['ann'], features: [{ manifest, elements: [], tools: [], formats: [], panels: [], commands }] });
  return board.editors('from-text')[0];
};
const graph = (src: string) => {
  const d = parsePlantUml(src);
  if (d.kind === 'sequence') throw new Error('expected a graph');
  return d as Exclude<PlantUmlDiagram, { kind: 'sequence' }>;
};

const CLASSES = `@startuml
package Shop {
  abstract class Product {
    -id : UUID
    {abstract} +price() : Money
  }
  class Book extends Product
  interface Shippable {
    +weight() : Grams
  }
}
class Order {
  +total() : Money
}
Book ..|> Shippable
Order "1" *-- "many" LineItem : contains
@enduml`;

it('a pasted PlantUML class diagram lands as class boxes with their members, lines with UML ends and multiplicities, a package as the frame holding its classes, its source kept for edits', () => {
  expect(detectKind(CLASSES)).toBe('plantuml');
  const ed = open();
  insertLaid(ed, 'plantuml', CLASSES, layoutText('plantuml', CLASSES), { x: 0, y: 0 });
  const els = ed.getElements();
  const box = (name: string) => els.find((e): e is ShapeElement => e.type === 'shape' && richTextToPlain(e.text).split('\n')[0].endsWith(name))!;
  const line = (a: ShapeElement, b: ShapeElement) => els.find((e): e is ConnectorElement => e.type === 'connector' && e.start.elementId === a.id && e.end.elementId === b.id)!;
  const [product, book, shippable, order, item] = ['Product', 'Book', 'Shippable', 'Order', 'LineItem'].map(box);
  expect([product.shape, product.compartments]).toEqual(['umlClass', true]);
  expect(richTextToPlain(product.text).split('\n')).toEqual(['Product', '-id : UUID', '+price() : Money']);
  expect(richTextToPlain(shippable.text).split('\n')[0]).toBe('«interface» Shippable');
  expect(line(book, product).endCap).toBe('triangleOpen'); // extends: generalisation
  expect([line(book, shippable).endCap, line(book, shippable).strokeStyle]).toEqual(['triangleOpen', 'dashed']); // realisation
  const contains = line(order, item);
  expect([contains.startCap, contains.endCap, richTextToPlain(contains.label)]).toEqual(['diamond', 'none', 'contains']); // composition, diamond at the whole
  expect(contains.labels?.map((l) => richTextToPlain(l.text))).toEqual(['1', 'many']);
  const shop = els.find((e): e is FrameElement => e.type === 'frame' && e.title === 'Shop')!;
  expect([product.frameId, book.frameId, shippable.frameId, order.frameId ?? null]).toEqual([shop.id, shop.id, shop.id, null]);
  expect(ed.collection(DIAGRAMS).entries()).toHaveLength(1);
});

it('a PlantUML activity is wired the way the flow reads: yes / no out of each decision, loops back to their condition, a stopped branch never rejoins', () => {
  const d = graph(`@startuml
start
:Pick items;
if (In stock?) then (yes)
  :Reserve;
else (no)
  :Apologise;
  stop
endif
while (More parcels?) is (yes)
  :Ship parcel;
endwhile (no)
:Thank;
stop
@enduml`);
  const id = (t: string) => d.nodes.find((n) => n.text === t)!.id;
  const out = (t: string) => d.edges.filter((e) => e.from === id(t)).map((e) => [d.nodes.find((n) => n.id === e.to)!.text || d.nodes.find((n) => n.id === e.to)!.shape, e.label ?? '']);
  expect(out('In stock?')).toEqual([['Reserve', 'yes'], ['Apologise', 'no']]);
  expect(out('Apologise')).toEqual([['bpmnEnd', '']]);
  expect(out('Reserve')).toEqual([['More parcels?', '']]);
  expect(out('Ship parcel')).toEqual([['More parcels?', '']]);
  expect(out('More parcels?')).toEqual([['Ship parcel', 'yes'], ['Thank', 'no']]);
});

it('PlantUML sequence aliases name the right lifelines: the alias is what messages use, the long name is what is shown; replies and reverse arrows go the right way', () => {
  const d = parsePlantUml(`@startuml
actor Customer as C
participant "Web shop" as W
participant API as "Order API"
C -> W : Pay
W -->> C : Receipt
W <- API : Confirmed
@enduml`);
  if (d.kind !== 'sequence') throw new Error(d.kind);
  expect(d.diagram.participants.map((p) => [p.id, p.label, !!p.actor])).toEqual([
    ['C', 'Customer', true],
    ['W', 'Web shop', false],
    ['API', 'Order API', false],
  ]);
  expect(d.diagram.steps.map((s) => (s.kind === 'message' ? [s.from, s.to, s.dashed, s.arrow] : null))).toEqual([
    ['C', 'W', false, 'arrow'],
    ['W', 'C', true, 'open'],
    ['API', 'W', false, 'arrow'],
  ]);
});

it('a component diagram with bodiless interfaces is read as components in their package and node frames, not as classes; use cases as ellipses for their actors', () => {
  const comp = graph(`@startuml
package "Front end" {
  [Web app] as Web
}
node "API server" {
  component Gateway
}
database "Orders DB" as DB
interface REST
Web --> REST
REST - Gateway
Gateway ..> DB : reads
@enduml`);
  expect(comp.kind).toBe('description');
  const kind = (id: string) => comp.nodes.find((n) => n.id === id)?.shape;
  expect([kind('Web'), kind('Gateway'), kind('DB'), kind('REST')]).toEqual(['umlComponent', 'umlComponent', 'cylinder', 'ellipse']);
  expect(comp.groups.map((g) => [g.title, g.nodes])).toEqual([
    ['Front end', ['Web']],
    ['API server', ['Gateway']],
  ]);
  expect(comp.edges.find((e) => e.from === 'Gateway')).toMatchObject({ to: 'DB', style: 'dashed', label: 'reads' });

  const uc = graph(`@startuml
actor "Shop admin" as Admin
:Customer: --> (Check out)
Admin --> (Manage stock)
(Check out) .> (Browse) : <<include>>
@enduml`);
  expect(uc.nodes.map((n) => [n.text, n.shape])).toEqual([
    ['Shop admin', 'umlActor'],
    ['Customer', 'umlActor'],
    ['Check out', 'ellipse'],
    ['Manage stock', 'ellipse'],
    ['Browse', 'ellipse'],
  ]);
  expect(uc.edges.at(-1)).toMatchObject({ style: 'dashed', label: '«include»' });
});

it('a PlantUML state diagram keeps composite states as frames holding their states, with a start dot and an end per scope', () => {
  const d = graph(`@startuml
[*] --> Draft
state Review {
  [*] --> Waiting
  Waiting --> Approved : approve
}
Draft --> Review : submit
Approved --> [*]
@enduml`);
  const review = d.groups.find((g) => g.title === 'Review')!;
  const shapeOf = (id: string) => d.nodes.find((n) => n.id === id)!.shape;
  expect(review.nodes.map(shapeOf)).toEqual(['ellipse', 'roundRect', 'roundRect']);
  expect(d.edges.find((e) => e.label === 'submit')).toMatchObject({ from: 'Draft', to: 'Review' }); // into the composite's frame
  expect(d.nodes.filter((n) => n.shape === 'bpmnEnd')).toHaveLength(1);
});

it('PlantUML that can’t be read adds nothing and names the line; files are never included', () => {
  const ed = open();
  const notes: string[] = [];
  ed.host.notify = (m: string) => void notes.push(m);
  ed.runCommand('from-text.insert', { kind: 'plantuml', text: '@startuml\nclass A\nA --> B\nthis is not plantuml\n@enduml', at: { x: 0, y: 0 } });
  ed.runCommand('from-text.insert', { kind: 'plantuml', text: '@startuml\n!include https://example.com/x.puml\nA -> B\n@enduml', at: { x: 0, y: 0 } });
  expect(notes).toEqual([expect.stringMatching(/line 4/), expect.stringMatching(/line 2: files are never included/)]);
  expect(ed.getElements()).toEqual([]);
});

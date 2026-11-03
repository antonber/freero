// Value streams and data flows (#133): a lean value-stream map, a data-flow diagram and a threat
// model, drawn with the shape library's value-stream and data-flow sets.
import { Kit, list, rt } from '../kit';
import { AMBER, CORAL, INK, INK_SOFT, LINE, MINT, SKY, TINT, VIOLET } from '../palette';
import type { TemplateDef } from '../types';

export const valueStreamMap: TemplateDef = {
  id: 'value-stream-map',
  name: 'Value stream map',
  description: 'A current-state value stream: supplier to customer, inventory between steps, data boxes and a lead-time ladder.',
  categories: ['operations', 'diagramming'],
  keywords: ['value stream', 'vsm', 'lean', 'kaizen', 'lead time', 'cycle time', 'inventory', 'manufacturing', 'process improvement', 'gemba'],
  build(newId) {
    const k = new Kit(newId);
    const W = 2120;
    const H = 1040;
    k.frame('Value stream map', W, H);
    k.header('Value stream map', 'Material flows left to right along the bottom, information right to left along the top. Fill in each data box, then mark what to improve with a kaizen burst.', W);
    const sym = { fill: '#FFFFFF', stroke: LINE, fontSize: 15 };
    const bare = { fill: '#FFFFFF', stroke: LINE };

    // Information flow, along the top.
    const supplier = k.shape('vsmSupplier', 96, 176, 190, 130, '<b>Coil steel</b><br>supplier', sym);
    const control = k.shape('rect', 860, 176, 320, 120, '<b>Production control</b><br>MRP · weekly schedule', { fill: TINT.sky, stroke: SKY, fontSize: 16 });
    const customer = k.shape('vsmSupplier', 1834, 176, 190, 130, '<b>Customer</b><br>18,400 pcs / month', sym);
    k.shape('vsmElectronic', 470, 196, 200, 80, '', { ...bare, rotation: 180 });
    k.text(450, 286, 240, rt('6-week forecast'), { size: 15, color: INK_SOFT, align: 'center', h: 24 });
    k.shape('vsmElectronic', 1440, 196, 200, 80, '', { ...bare, rotation: 180 });
    k.text(1420, 286, 240, rt('Daily orders'), { size: 15, color: INK_SOFT, align: 'center', h: 24 });

    // Shipments in and out.
    const inbound = k.shape('vsmTruck', 116, 380, 150, 90, 'Mon + Thu', { ...sym, fontSize: 14 });
    const outbound = k.shape('vsmTruck', 1854, 380, 150, 90, 'Daily', { ...sym, fontSize: 14 });
    k.connector({ id: supplier, anchor: 'bottom' }, { id: inbound, anchor: 'top' }, { routing: 'straight', stroke: LINE });

    // The process row: each step with its operator and data box, inventory between steps.
    const steps = [
      { name: 'Stamping', data: ['C/T = 1 s', 'C/O = 1 h', 'Uptime = 85%', 'Operators = 1'] },
      { name: 'Welding', data: ['C/T = 39 s', 'C/O = 10 min', 'Uptime = 100%', 'Operators = 1'] },
      { name: 'Assembly', data: ['C/T = 62 s', 'C/O = 0', 'Uptime = 100%', 'Operators = 2'] },
      { name: 'Shipping', data: ['C/T = 40 s', 'Batch = 1 truck', 'Uptime = 100%', 'Operators = 1'] },
    ];
    const px = (i: number) => 400 + i * 380;
    const py = 560;
    const ids = steps.map((s, i) => {
      const id = k.shape('vsmProcess', px(i), py, 200, 140, `<b>${rt(s.name)}</b>`, { ...sym, fontSize: 16 });
      k.shape('netUser', px(i) + 82, py + 58, 36, 64, '', { fill: TINT.violet, stroke: VIOLET });
      k.shape('vsmDataBox', px(i), 724, 200, 116, s.data.map(rt).join('<br>'), { ...sym, fontSize: 14, align: 'left', vAlign: 'top' });
      k.connector({ id: control, anchor: 'bottom' }, { id, anchor: 'top' }, { strokeStyle: 'dashed', stroke: INK_SOFT });
      return id;
    });
    // Raw material before the first step, pushed in.
    const raw = k.shape('vsmInventory', 220, 580, 80, 70, '', { fill: TINT.amber, stroke: AMBER });
    k.text(180, 654, 160, rt('Coils · 5 days'), { size: 14, align: 'center', h: 24 });
    k.connector({ id: inbound, anchor: 'bottom' }, { id: raw, anchor: 'top' }, { routing: 'straight', stroke: LINE });
    k.shape('vsmPush', 308, 610, 84, 40, '', bare);
    // Work in progress pushed between the first steps.
    const wip = ['2,400 pcs · 2 days', '1,800 pcs · 1.5 days'];
    wip.forEach((label, i) => {
      const gap = px(i) + 200;
      k.shape('vsmInventory', gap + 50, 572, 80, 70, '', { fill: TINT.amber, stroke: AMBER });
      k.text(gap + 10, 646, 160, rt(label), { size: 14, align: 'center', h: 24 });
      k.shape('vsmPush', gap + 20, 684, 140, 36, '', bare);
    });
    // Finished goods in a supermarket that shipping pulls from.
    const fg = px(2) + 200;
    k.shape('vsmSupermarket', fg + 55, 568, 70, 90, '', { fill: TINT.mint, stroke: MINT });
    k.shape('vsmPull', fg + 50, 664, 80, 52, '', bare);
    k.text(fg + 8, 742, 164, rt('Finished · 2.5 days'), { size: 14, align: 'center', h: 24 });
    k.connector({ id: ids[3], anchor: 'right' }, { id: outbound, anchor: 'bottom' }, { stroke: LINE });
    k.connector({ id: outbound, anchor: 'top' }, { id: customer, anchor: 'bottom' }, { routing: 'straight', stroke: LINE });

    // Where to improve.
    k.shape('vsmKaizen', 410, 396, 180, 120, '<b>Smaller batches</b>', { fill: TINT.coral, stroke: CORAL, fontSize: 14 });
    k.shape('vsmKaizen', 955, 396, 180, 120, '<b>Cut changeover</b>', { fill: TINT.coral, stroke: CORAL, fontSize: 14 });

    // The lead-time ladder: waiting time up, processing time down.
    const up = 900;
    const down = 950;
    const rungs: Array<{ x0: number; x1: number; high: boolean; label: string }> = [
      { x0: 180, x1: 400, high: true, label: '5 days' },
      { x0: 400, x1: 600, high: false, label: '1 s' },
      { x0: 600, x1: 780, high: true, label: '2 days' },
      { x0: 780, x1: 980, high: false, label: '39 s' },
      { x0: 980, x1: 1160, high: true, label: '1.5 days' },
      { x0: 1160, x1: 1360, high: false, label: '62 s' },
      { x0: 1360, x1: 1540, high: true, label: '2.5 days' },
      { x0: 1540, x1: 1740, high: false, label: '40 s' },
    ];
    const ladder = { routing: 'straight' as const, endCap: 'none' as const, stroke: INK };
    rungs.forEach((r, i) => {
      const y = r.high ? up : down;
      k.connector({ x: r.x0, y }, { x: r.x1, y }, ladder);
      if (i > 0) k.connector({ x: r.x0, y: up }, { x: r.x0, y: down }, ladder);
      k.text(r.x0, r.high ? up - 34 : down + 6, r.x1 - r.x0, rt(r.label), { size: 15, align: 'center', color: r.high ? INK : INK_SOFT, h: 24 });
    });
    k.shape('rect', 1790, 870, 290, 110, '<b>Lead time</b> 11 days<br><b>Processing</b> 142 s', { fill: TINT.mint, stroke: MINT, fontSize: 16 });
    return k.done();
  },
};

const dfd = { fill: '#FFFFFF', stroke: LINE, fontSize: 16 };

export const dataFlowDiagram: TemplateDef = {
  id: 'data-flow-diagram',
  name: 'Data-flow diagram',
  description: 'How data moves through an online shop: who sends it, what transforms it and where it is kept.',
  categories: ['engineering', 'diagramming'],
  keywords: ['data flow diagram', 'dfd', 'gane sarson', 'yourdon', 'data store', 'external entity', 'system analysis', 'context diagram', 'level 1'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1880;
    const H = 920;
    k.frame('Data-flow diagram', W, H);
    k.header('Data-flow diagram', 'Rounded boxes change data, open boxes keep it, square ones are outside the system. Name every arrow after the data it carries.', W);
    const outside = { ...dfd, fill: TINT.violet, stroke: VIOLET, fontSize: 17 };
    const store = { ...dfd, fill: TINT.mint, stroke: MINT };

    const customer = k.shape('dfdExternal', 96, 400, 200, 110, '<b>Customer</b>', outside);
    const take = k.shape('dfdProcess', 520, 210, 230, 120, '<b>Take order</b>', dfd);
    const pay = k.shape('dfdProcess', 520, 600, 230, 120, '<b>Take payment</b>', dfd);
    const orders = k.shape('dfdStore', 1000, 240, 230, 60, 'Orders', store);
    const ship = k.shape('dfdProcess', 1000, 420, 230, 120, '<b>Ship order</b>', dfd);
    const provider = k.shape('dfdExternal', 1000, 605, 230, 110, '<b>Payment provider</b>', outside);
    const products = k.shape('dfdStore', 1000, 780, 230, 60, 'Products', store);
    const warehouse = k.shape('dfdExternal', 1560, 425, 220, 110, '<b>Warehouse</b>', outside);

    const flow = (a: string, as: 'top' | 'right' | 'bottom' | 'left', b: string, bs: 'top' | 'right' | 'bottom' | 'left', label: string) =>
      k.connector({ id: a, anchor: as }, { id: b, anchor: bs }, { label, stroke: LINE });
    flow(customer, 'top', take, 'left', 'order details');
    flow(take, 'right', orders, 'left', 'new order');
    flow(take, 'bottom', pay, 'top', 'amount due');
    flow(customer, 'bottom', pay, 'left', 'card details');
    flow(pay, 'right', provider, 'left', 'charge');
    flow(provider, 'top', ship, 'bottom', 'payment confirmed');
    flow(orders, 'bottom', ship, 'top', 'paid orders');
    flow(ship, 'right', warehouse, 'left', 'pick list');
    flow(products, 'left', pay, 'bottom', 'prices');
    k.text(1300, 236, 520, list(['Every process has data in and data out.', 'Data only moves through a process: never store to store.', 'Number processes to break one into its own diagram.']), { size: 15, color: INK_SOFT });
    return k.done();
  },
};

export const threatModel: TemplateDef = {
  id: 'threat-model-diagram',
  name: 'Threat model diagram',
  description: 'A data-flow diagram with trust boundaries, and the questions to ask wherever data crosses one.',
  categories: ['engineering'],
  keywords: ['threat model', 'security review', 'stride', 'trust boundary', 'data flow', 'attack surface', 'appsec', 'risk'],
  build(newId) {
    const k = new Kit(newId);
    const W = 2240;
    const H = 920;
    k.frame('Threat model', W, H);
    k.header('Threat model', 'Draw what the system does with data, mark where trust changes, then walk every arrow that crosses a dashed line.', W);
    const outside = { ...dfd, fill: TINT.violet, stroke: VIOLET, fontSize: 17 };

    // The zone the team runs: a dashed boundary with its name in the corner.
    k.shape('dfdBoundary', 560, 180, 900, 640, '', { fill: 'transparent', fillOpacity: 0, stroke: CORAL, strokeStyle: 'dashed' });
    k.text(584, 192, 420, '<b>Trust boundary · production</b>', { size: 15, color: CORAL, h: 24 });
    const browser = k.shape('dfdExternal', 96, 295, 210, 110, '<b>Browser</b>', outside);
    const web = k.shape('dfdProcess', 640, 290, 230, 120, '<b>Web app</b>', dfd);
    const api = k.shape('dfdProcess', 1040, 290, 230, 120, '<b>API</b>', dfd);
    const signIn = k.shape('dfdProcess', 640, 580, 230, 120, '<b>Sign-in</b>', dfd);
    const db = k.shape('dfdStore', 1040, 610, 230, 60, 'Accounts', { ...dfd, fill: TINT.mint, stroke: MINT });
    const provider = k.shape('dfdExternal', 1560, 300, 220, 110, '<b>Payment provider</b>', outside);

    const flow = (a: string, as: 'top' | 'right' | 'bottom' | 'left', b: string, bs: 'top' | 'right' | 'bottom' | 'left', label: string) =>
      k.connector({ id: a, anchor: as }, { id: b, anchor: bs }, { label, stroke: LINE });
    flow(browser, 'right', web, 'left', 'HTTPS request');
    flow(web, 'right', api, 'left', 'JSON + session');
    flow(web, 'bottom', signIn, 'top', 'credentials');
    flow(signIn, 'right', db, 'left', 'password hash');
    flow(api, 'bottom', db, 'top', 'SQL');
    flow(api, 'right', provider, 'left', 'charge');

    const y = k.section(1840, 176, 360, 420, 'At every crossing ask', TINT.coral, { accent: CORAL, size: 20 });
    k.text(1860, y, 320, list([
      'Spoofing: could someone pretend to be this sender?',
      'Tampering: could the data change on the way?',
      'Repudiation: could someone deny they sent it?',
      'Information disclosure: who else could read it?',
      'Denial of service: what if it floods or stops?',
      'Elevation of privilege: could it unlock more than it should?',
    ]), { size: 15, color: LINE });
    k.text(96, 470, 420, rt('Number each crossing and note what stops each threat, or who owns fixing it.'), { size: 15, color: INK_SOFT });
    return k.done();
  },
};

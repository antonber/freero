// Engineering: sequence diagram, data model (ERD), system architecture, incident timeline,
// postmortem, architecture decision record, CI/CD pipeline, bug triage.
import type { CapStyle, StickyColor } from '@freero/shared';
import { CircleCheck, FileText, Search, Siren, Users, Wrench } from 'lucide-react';
import { Kit, kanbanSize, list, rt, titled, type KanbanColumnSpec } from '../kit';
import { AMBER, CORAL, HEAD, INK, INK_SOFT, LINE, MINT, SKY, TINT, VIOLET } from '../palette';
import type { TemplateDef } from '../types';

export const sequenceDiagram: TemplateDef = {
  id: 'sequence-diagram',
  name: 'Sequence diagram',
  description: 'A sign-in flow as UML lifelines, activation bars, calls, replies and an alt fragment.',
  categories: ['engineering', 'diagramming'],
  keywords: ['sequence diagram', 'uml', 'interaction', 'lifeline', 'messages', 'api flow', 'call flow', 'sign in'],
  build(newId) {
    const k = new Kit(newId);
    const lifeW = 160;
    const step = 320;
    const top = 176;
    const lifeH = 720;
    const names = ['Browser', 'Web app', 'Auth service', 'Database'];
    const W = 96 + 3 * step + lifeW + 48 + 320 + 48;
    k.frame('Sequence diagram', W, top + lifeH + 48);
    k.header('Sequence diagram: sign in', 'Time runs down. Solid arrows are calls, dashed ones replies. Drag a message end along a lifeline to reorder it.', W);
    const lx = (i: number) => 96 + i * step;
    names.forEach((n, i) =>
      k.shape('umlLifeline', lx(i), top, lifeW, lifeH, `<b>${rt(n)}</b>`, { fill: i === 0 ? HEAD.sky : HEAD.violet, stroke: LINE, fontSize: 17 }),
    );
    // Activation bars (on the stems): [lifeline, from y, to y].
    const bars: Array<[number, number, number]> = [
      [0, 250, 740],
      [1, 260, 720],
      [2, 300, 680],
      [3, 340, 400],
    ];
    const act = bars.map(([i, y0, y1]) => ({ id: k.shape('umlActivation', lx(i) + lifeW / 2 - 8, y0, 16, y1 - y0, '', { fill: '#F2F1F7', stroke: LINE }), y0, y1 }));
    const msg = (from: number, to: number, y: number, label: string, reply = false) => {
      const a = act[from];
      const b = act[to];
      const right = to > from;
      k.connector(
        { id: a.id, at: { u: right ? 1 : 0, v: (y - a.y0) / (a.y1 - a.y0) } },
        { id: b.id, at: { u: right ? 0 : 1, v: (y - b.y0) / (b.y1 - b.y0) } },
        { routing: 'straight', label, endCap: reply ? 'arrow' : 'triangle', strokeStyle: reply ? 'dashed' : 'solid', stroke: INK },
      );
    };
    msg(0, 1, 272, 'POST /sign-in');
    msg(1, 2, 312, 'check password');
    msg(2, 3, 352, 'find user by email');
    msg(3, 2, 392, 'user row', true);

    // alt: the two outcomes, split by a dashed divider.
    const fx = 64;
    const fw = lx(3) + 40 - fx;
    k.shape('umlFragment', fx, 432, fw, 376, '<b>alt</b>', { fill: 'transparent', fillOpacity: 0, stroke: INK_SOFT, fontSize: 14, align: 'left' });
    k.text(lx(1) + 120, 440, 190, rt('[password matches]'), { size: 15, color: INK_SOFT, h: 24 });
    msg(2, 1, 500, 'session token', true);
    msg(1, 0, 540, '302 → /boards', true);
    k.connector({ x: fx, y: 600 }, { x: fx + fw, y: 600 }, { routing: 'straight', strokeStyle: 'dashed', stroke: INK_SOFT, endCap: 'none' });
    k.text(lx(1) + 120, 608, 190, rt('[else]'), { size: 15, color: INK_SOFT, h: 24 });
    msg(2, 1, 660, '401 wrong password', true);
    msg(1, 0, 700, 'show error', true);

    const nx = lx(3) + lifeW + 48;
    k.shape('umlNote', nx, top, 320, 220, titled('Notes', 'Add a lifeline per system that takes part. Keep message names to what is sent, not how.'), {
      fill: TINT.amber,
      stroke: AMBER,
      fontSize: 16,
      align: 'left',
      vAlign: 'top',
    });
    k.shape('umlNote', nx, top + 244, 320, 180, titled('Open question', 'Should failed attempts be rate limited per email or per IP?'), {
      fill: TINT.coral,
      stroke: CORAL,
      fontSize: 16,
      align: 'left',
      vAlign: 'top',
    });
    return k.done();
  },
};

/** ERD entity text: bold name, then one attribute per line (keys marked). */
const entity = (name: string, attrs: string[]) => `<b>${rt(name)}</b><br>${attrs.map((a) => rt(a).replace(/^(PK|FK) /, '$1&nbsp; ')).join('<br>')}`;
const entityH = (attrs: number) => Math.round(20 + (attrs + 1) * 14 * 1.7 + 12);

export const dataModel: TemplateDef = {
  id: 'data-model-erd',
  name: 'Data model (ERD)',
  description: 'An online shop’s tables and how they relate, drawn with crow’s-foot ends.',
  categories: ['engineering', 'diagramming'],
  keywords: ['erd', 'entity relationship', 'data model', 'database schema', 'schema', 'tables', "crow's foot", 'crows foot', 'sql'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1680;
    const ew = 240;
    const style = { fill: '#FFFFFF', stroke: LINE, fontSize: 14, align: 'left' as const, vAlign: 'top' as const };
    const rowA = 200;
    const rowB = 520;
    k.frame('Data model', W, rowB + entityH(5) + 64);
    k.header('Data model: online shop', 'One box per table, primary (PK) and foreign (FK) keys first. Read each line’s ends as “how many on this side”.', W);
    const ent = (x: number, y: number, name: string, attrs: string[], fill = '#FFFFFF') => k.shape('erdEntity', x, y, ew, entityH(attrs.length), entity(name, attrs), { ...style, fill });
    const customer = ent(96, rowA, 'customer', ['PK id', 'email', 'name', 'created_at'], TINT.violet);
    const order = ent(496, rowA, 'order', ['PK id', 'FK customer_id', 'placed_at', 'status'], TINT.sky);
    const payment = ent(896, rowA, 'payment', ['PK id', 'FK order_id', 'amount', 'paid_at']);
    const address = ent(96, rowB, 'address', ['PK id', 'FK customer_id', 'street', 'city', 'postcode']);
    const line = ent(496, rowB, 'order_line', ['PK id', 'FK order_id', 'FK product_id', 'quantity', 'unit_price'], TINT.sky);
    const product = ent(896, rowB, 'product', ['PK id', 'FK category_id', 'name', 'price']);
    const category = ent(1296, rowB, 'category', ['PK id', 'name']);
    const rel = (a: string, aSide: 'right' | 'bottom' | 'left', b: string, bSide: 'left' | 'top' | 'right', label: string, startCap: CapStyle, endCap: CapStyle) =>
      k.connector({ id: a, anchor: aSide }, { id: b, anchor: bSide }, { label, startCap, endCap, stroke: LINE });
    rel(customer, 'right', order, 'left', 'places', 'one', 'zeroOrMany');
    rel(customer, 'bottom', address, 'top', 'ships to', 'one', 'oneOrMany');
    rel(order, 'bottom', line, 'top', 'contains', 'one', 'oneOrMany');
    rel(order, 'right', payment, 'left', 'is paid by', 'one', 'zeroOrMany');
    rel(product, 'left', line, 'right', 'appears in', 'one', 'zeroOrMany');
    rel(category, 'left', product, 'right', 'groups', 'one', 'zeroOrMany');

    const lx = 1296;
    const y = k.section(lx, 176, 336, 296, 'Reading the ends', TINT.gray, { size: 20 });
    const ends: Array<[CapStyle, string]> = [
      ['one', 'exactly one'],
      ['zeroOrOne', 'zero or one'],
      ['oneOrMany', 'one or more'],
      ['zeroOrMany', 'zero or more'],
    ];
    ends.forEach(([cap, label], i) => {
      const ry = y + 12 + i * 52;
      k.connector({ x: lx + 24, y: ry + 12 }, { x: lx + 112, y: ry + 12 }, { routing: 'straight', endCap: cap, stroke: INK });
      k.text(lx + 132, ry, 180, rt(label), { size: 17, h: 26 });
    });
    return k.done();
  },
};

export const systemArchitecture: TemplateDef = {
  id: 'system-architecture',
  name: 'System architecture',
  description: 'Users, apps, services, data stores and outside providers, with what talks to what.',
  categories: ['engineering', 'diagramming'],
  keywords: ['architecture', 'system context', 'container diagram', 'c4', 'infrastructure', 'network diagram', 'cloud', 'services', 'system design'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1880;
    const H = 860;
    k.frame('System architecture', W, H);
    k.header('System architecture', 'Label every line with what it carries. Dashed lines are asynchronous. Keep one level of detail per diagram.', W);
    const net = { fill: '#FFFFFF', stroke: LINE, fontSize: 15 };
    const users = k.shape('netUser', 96, 330, 120, 160, '<b>Customers</b>', net);
    const web = k.shape('netLaptop', 320, 200, 180, 140, '<b>Web app</b><br>React', net);
    const mobile = k.shape('netPhone', 360, 430, 100, 170, '<b>Mobile</b>', net);

    // The cloud account boundary: a dashed panel with its name in the corner.
    k.shape('roundRect', 580, 176, 1000, 620, '', { fill: TINT.sky, stroke: SKY, strokeStyle: 'dashed', strokeWidth: 2 });
    k.text(604, 188, 400, '<b>Production · cloud region</b>', { size: 16, color: SKY, h: 24 });
    // A firewall's bricks would cross its own text: it is labelled underneath instead.
    const edge = k.shape('netFirewall', 625, 330, 130, 90, '', net);
    k.text(600, 428, 180, '<b>Edge firewall</b>', { size: 15, align: 'center', h: 24 });
    const api = k.shape('netServer', 860, 230, 210, 130, '<b>API service</b>', net);
    const auth = k.shape('umlComponent', 860, 430, 210, 100, '<b>Auth</b>', { ...net, fill: TINT.violet, stroke: VIOLET });
    const worker = k.shape('netServer', 860, 610, 210, 130, '<b>Worker</b>', net);
    const db = k.shape('cylinder', 1200, 230, 150, 130, '<b>Postgres</b>', { ...net, fill: TINT.mint, stroke: MINT });
    const queue = k.shape('cylinder', 1200, 470, 150, 130, '<b>Job queue</b>', { ...net, fill: TINT.amber, stroke: AMBER });
    const files = k.shape('document', 1400, 470, 150, 120, '<b>File storage</b>', net);

    const pay = k.shape('cloud', 1640, 230, 200, 130, '<b>Payments</b><br>provider', { ...net, fill: TINT.gray });
    const mail = k.shape('cloud', 1640, 600, 200, 130, '<b>Email</b><br>provider', { ...net, fill: TINT.gray });

    const call = (a: string, as: 'top' | 'right' | 'bottom' | 'left', b: string, bs: 'top' | 'right' | 'bottom' | 'left', label: string, async = false) =>
      k.connector({ id: a, anchor: as }, { id: b, anchor: bs }, { label, strokeStyle: async ? 'dashed' : 'solid', stroke: LINE });
    call(users, 'right', web, 'left', 'uses');
    call(users, 'right', mobile, 'left', 'uses');
    call(web, 'right', edge, 'left', 'HTTPS');
    call(mobile, 'right', edge, 'left', 'HTTPS');
    call(edge, 'right', api, 'left', 'routes');
    call(api, 'bottom', auth, 'top', 'checks token');
    call(api, 'right', db, 'left', 'SQL');
    call(api, 'right', queue, 'left', 'enqueue', true);
    call(worker, 'right', queue, 'bottom', 'consume', true);
    call(db, 'right', files, 'top', 'file refs');
    call(api, 'top', pay, 'left', 'charge');
    call(worker, 'bottom', mail, 'bottom', 'send', true);
    return k.done();
  },
};

export const incidentTimeline: TemplateDef = {
  id: 'incident-timeline',
  name: 'Incident timeline',
  description: 'What happened when during an outage, from first alert to follow-up, with impact and lessons.',
  categories: ['engineering', 'meetings'],
  keywords: ['incident', 'outage', 'timeline', 'on-call', 'sre', 'postmortem', 'events', 'incident response', 'chronology'],
  build(newId) {
    const k = new Kit(newId);
    const step = 264;
    const cardW = 232;
    const events = [
      { icon: Siren, color: CORAL, title: '14:02 · Alert fires', body: 'Checkout error rate above 5%' },
      { icon: Search, color: AMBER, title: '14:09 · Investigating', body: 'On-call sees payment timeouts' },
      { icon: Users, color: VIOLET, title: '14:15 · Incident call', body: 'Lead, comms and a scribe assigned' },
      { icon: Wrench, color: SKY, title: '14:31 · Mitigated', body: 'Last deploy rolled back' },
      { icon: CircleCheck, color: MINT, title: '15:05 · Resolved', body: 'Errors back to normal for 30 min' },
      { icon: FileText, color: INK_SOFT, title: 'Next day · Review', body: 'Blameless postmortem booked' },
    ];
    const W = 96 + (events.length - 1) * step + cardW + 48;
    const axisY = 440;
    const lowY = 720;
    const lowH = 260;
    k.frame('Incident timeline', W, lowY + lowH + 48);
    k.header('Incident timeline', 'Write times in one time zone. Note facts, not blame: what was seen, what was done, what changed.', W);
    k.connector({ x: 64, y: axisY }, { x: W - 64, y: axisY }, { routing: 'straight', strokeWidth: 3, stroke: LINE });
    events.forEach((e, i) => {
      const x = 96 + i * step;
      const cx = x + cardW / 2;
      const above = i % 2 === 0;
      const card = k.shape('roundRect', x, above ? 210 : 552, cardW, 120, titled(e.title, e.body), { fill: '#FFFFFF', stroke: e.color, strokeWidth: 2, fontSize: 16 });
      const dot = k.shape('ellipse', cx - 26, axisY - 26, 52, 52, '', { fill: e.color, stroke: '#FFFFFF', strokeWidth: 3 });
      k.icon(cx - 14, axisY - 14, 28, e.icon, '#FFFFFF', 2.25);
      k.connector({ id: card, anchor: above ? 'bottom' : 'top' }, { id: dot, anchor: above ? 'top' : 'bottom' }, { routing: 'straight', endCap: 'none', strokeStyle: 'dashed', stroke: e.color });
    });
    const colW = (W - 96 - 48) / 3;
    const cols: Array<{ title: string; tint: string; accent: string; color: StickyColor; notes: string[] }> = [
      { title: 'Customer impact', tint: TINT.coral, accent: CORAL, color: 'coral', notes: ['1 in 6 checkouts failed for 29 min', 'Add support tickets, refunds…'] },
      { title: 'What helped', tint: TINT.mint, accent: MINT, color: 'green', notes: ['Rollback took 2 minutes', 'Clear roles on the call'] },
      { title: 'What slowed us down', tint: TINT.amber, accent: AMBER, color: 'yellow', notes: ['Alert had no runbook link', 'Status page updated late'] },
    ];
    cols.forEach((c, i) => {
      const x = 48 + i * (colW + 24);
      const y = k.section(x, lowY, colW, lowH, c.title, c.tint, { accent: c.accent });
      k.stickies(x + 24, y, colW - 48, c.notes, c.color, 170);
    });
    return k.done();
  },
};

export const postmortem: TemplateDef = {
  id: 'incident-postmortem',
  name: 'Incident postmortem',
  description: 'A blameless review: summary, what happened, five whys to the root cause and owned actions.',
  categories: ['engineering', 'meetings'],
  keywords: ['postmortem', 'post-mortem', 'incident review', 'root cause', 'rca', '5 whys', 'five whys', 'blameless', 'retrospective', 'outage'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1760;
    const topY = 160;
    const sumRows = [
      ['Incident', 'Checkout failures after deploy'],
      ['Date', '12 March, 14:02–15:05 UTC'],
      ['Severity', 'S2 · major feature broken'],
      ['Detected by', 'Error-rate alert'],
      ['Incident lead', ''],
      ['Scribe', ''],
    ];
    const sumH = sumRows.length * 44;
    const whyY = topY + sumH + 32;
    const whyH = 230;
    const actY = whyY + whyH + 32;
    const actRows = [
      { h: 48, cells: ['Action', 'Owner', 'Type', 'Due', 'Status'] },
      { h: 56, cells: ['Link a runbook from every paging alert', '', 'Detect', '', 'To do'] },
      { h: 56, cells: ['Add a timeout test for the payment client', '', 'Prevent', '', 'To do'] },
      { h: 56, cells: ['Canary deploys for checkout', '', 'Mitigate', '', 'To do'] },
      { h: 56, cells: ['Status page update within 10 minutes', '', 'Respond', '', 'To do'] },
    ];
    const actH = actRows.reduce((a, r) => a + r.h, 0);
    k.frame('Incident postmortem', W, actY + actH + 48);
    k.header('Incident postmortem', 'Blameless: ask how the system let this happen, not who did it. Every action gets an owner and a date.', W);
    k.table(48, topY, [200, 440], sumRows.map((cells) => ({ h: 44, cells })), { header: false, fills: { 0: TINT.gray } });
    const sx = 48 + 640 + 24;
    const sw = W - 48 - sx;
    const y = k.section(sx, topY, sw, sumH, 'What happened', TINT.sky, { accent: SKY, hint: 'Two or three sentences a newcomer would understand.' });
    k.text(sx + 24, y, sw - 48, rt('A config change shortened the payment client’s timeout to 2 s. Under normal afternoon load the provider answered in 2–3 s, so about one in six checkouts failed until the deploy was rolled back.'), { size: 18, h: sumH - (y - topY) - 16 });

    k.text(48, whyY, 600, '<b>Five whys</b>', { size: 22, h: 32 });
    const whys = [
      'Why did checkouts fail?\nPayment calls timed out',
      'Why did they time out?\nTimeout dropped to 2 s',
      'Why was it lowered?\nTo free up worker threads',
      'Why wasn’t it caught?\nNo test with real latency',
      'Root cause\nTimeouts change without a load check',
    ];
    const bw = Math.floor((W - 96 - 4 * 48) / 5);
    let prev: string | null = null;
    whys.forEach((t, i) => {
      const [q, a] = t.split('\n');
      const id = k.shape('roundRect', 48 + i * (bw + 48), whyY + 48, bw, whyH - 48, titled(q, a), {
        fill: i === whys.length - 1 ? HEAD.coral : '#FFFFFF',
        stroke: i === whys.length - 1 ? CORAL : LINE,
        fontSize: 17,
      });
      if (prev) k.connector({ id: prev, anchor: 'right' }, { id, anchor: 'left' }, { stroke: LINE });
      prev = id;
    });
    k.table(48, actY, [640, 240, 200, 200, 200], actRows);
    const nx = 48 + 1480 + 24;
    k.sticky(nx, actY, 'Blameless reminder: people did reasonable things with what they knew.', 'violet', W - 48 - nx, actH);
    return k.done();
  },
};

export const adr: TemplateDef = {
  id: 'architecture-decision-record',
  name: 'Architecture decision record',
  description: 'Context, options with pros and cons, the decision and its consequences, on one board.',
  categories: ['engineering', 'meetings'],
  keywords: ['adr', 'architecture decision', 'decision record', 'technical decision', 'design doc', 'rfc', 'options', 'trade-offs'],
  build(newId) {
    const k = new Kit(newId);
    const W = 1760;
    const top = 160;
    const rowH = 240;
    const optY = top + rowH + 24;
    const optRows = [
      { h: 48, cells: ['Option', 'Pros', 'Cons', 'Effort'] },
      { h: 84, cells: ['A · Keep polling every 5 s', 'Nothing to build; works through every proxy', 'Wasteful; updates feel slow; load grows with users', 'None'] },
      { h: 84, cells: ['B · WebSockets', 'Instant updates; one connection per tab', 'Sticky sessions; more to run and monitor', 'Medium'] },
      { h: 84, cells: ['C · Server-sent events', 'Simple, plain HTTP; auto-reconnect built in', 'One direction only; writes still go over REST', 'Small'] },
    ];
    const optH = optRows.reduce((a, r) => a + r.h, 0);
    const endY = optY + optH + 24;
    const endH = 250;
    k.frame('Architecture decision record', W, endY + endH + 48);
    k.header('ADR 012: How clients get live updates', 'One decision per record. Never edit an accepted ADR: write a new one that supersedes it.', W);
    k.table(48, top, [170, 300], [
      { h: 48, cells: ['Status', { t: 'Proposed', f: HEAD.amber }] },
      { h: 48, cells: ['Date', ''] },
      { h: 48, cells: ['Deciders', ''] },
      { h: 48, cells: ['Supersedes', '—'] },
      { h: 48, cells: ['Review by', ''] },
    ], { header: false, fills: { 0: TINT.gray } });
    const cx = 48 + 470 + 24;
    const cw = W - 48 - cx;
    const y = k.section(cx, top, cw, rowH, 'Context', TINT.sky, { accent: SKY, hint: 'The forces at play: what is true now and why a decision is needed.' });
    k.text(cx + 24, y, cw - 48, list(['Clients poll for board changes every 5 seconds', 'Polling is 60% of API traffic and still feels laggy', 'We expect 3× more concurrent users by summer']), { size: 18, h: rowH - (y - top) - 12 });
    k.table(48, optY, [300, 560, 560, 244], optRows);
    const half = (W - 96 - 24) / 2;
    let dy = k.section(48, endY, half, endH, 'Decision', TINT.mint, { accent: MINT, hint: 'What we will do, in one or two sentences.' });
    k.text(72, dy, half - 48, rt('We will use WebSockets (option B) for board updates and keep REST for everything else.'), { size: 20, h: endH - (dy - endY) - 16 });
    dy = k.section(48 + half + 24, endY, half, endH, 'Consequences', TINT.gray, { hint: 'What becomes easier, and what becomes harder.' });
    const sw = (half - 48 - 16) / 2;
    k.sticky(48 + half + 48, dy, 'Easier: live cursors and presence come almost free', 'green', sw, endH - (dy - endY) - 20);
    k.sticky(48 + half + 48 + sw + 16, dy, 'Harder: load balancer needs sticky sessions', 'coral', sw, endH - (dy - endY) - 20);
    return k.done();
  },
};

export const cicdPipeline: TemplateDef = {
  id: 'cicd-pipeline',
  name: 'CI/CD pipeline',
  description: 'From pull request to production across four lanes, with BPMN events, tasks and gateways.',
  categories: ['engineering', 'diagramming'],
  keywords: ['ci/cd', 'cicd', 'pipeline', 'continuous integration', 'continuous delivery', 'deployment', 'devops', 'release process', 'bpmn', 'swimlane'],
  build(newId) {
    const k = new Kit(newId);
    const laneH = 170;
    const phaseW = 1560;
    const pool = { x: 48, y: 160 };
    const lanes = [
      { title: 'Developer', size: laneH, color: HEAD.violet },
      { title: 'CI', size: laneH, color: HEAD.sky },
      { title: 'Staging', size: laneH, color: HEAD.amber },
      { title: 'Production', size: laneH, color: HEAD.mint },
    ];
    const W = 48 + 150 + phaseW + 48;
    const poolH = 44 + 4 * laneH;
    k.frame('CI/CD pipeline', W, pool.y + poolH + 48);
    k.header('CI/CD pipeline', 'Each lane is who (or what) does the step. Add lanes for approvals; gateways ask a yes/no question.', W);
    const p = k.swimlane(pool.x, pool.y, 'From pull request to production', lanes, [{ title: 'Flow', size: phaseW, color: HEAD.gray }]);
    const px = p.phase(0).x;
    const cy = (i: number) => p.lane(i).y + laneH / 2;
    const task = { fill: '#FFFFFF', stroke: LINE, fontSize: 16 };
    const ev = { fill: '#FFFFFF', stroke: LINE, strokeWidth: 2 };
    const ids: Record<string, string> = {};
    k.within(p.id, () => {
      ids.start = k.shape('ellipse', px + 40, cy(0) - 28, 56, 56, '', { ...ev, stroke: MINT, strokeWidth: 3 });
      k.text(px + 16, cy(0) + 36, 104, rt('Change ready'), { size: 14, color: INK_SOFT, align: 'center', h: 22 });
      ids.pr = k.shape('roundRect', px + 160, cy(0) - 40, 180, 80, 'Open a pull request', task);
      ids.fix = k.shape('roundRect', px + 560, cy(0) - 40, 180, 80, 'Fix and push again', task);
      ids.test = k.shape('roundRect', px + 340, cy(1) - 40, 180, 80, 'Run tests and lint', task);
      ids.ok = k.shape('bpmnGatewayX', px + 614, cy(1) - 36, 72, 72, '', ev);
      k.text(px + 580, cy(1) + 42, 140, rt('Checks pass?'), { size: 14, color: INK_SOFT, align: 'center', h: 22 });
      ids.build = k.shape('roundRect', px + 820, cy(1) - 40, 180, 80, 'Build and sign the image', task);
      ids.stage = k.shape('roundRect', px + 1000, cy(2) - 40, 180, 80, 'Deploy to staging', task);
      ids.soak = k.shape('bpmnTimerEvent', px + 1230, cy(2) - 28, 56, 56, '', ev);
      k.text(px + 1206, cy(2) + 34, 104, rt('Soak 30 min'), { size: 14, color: INK_SOFT, align: 'center', h: 22 });
      ids.healthy = k.shape('bpmnGatewayX', px + 1340, cy(2) - 36, 72, 72, '', ev);
      k.text(px + 1420, cy(2) - 11, 120, rt('Healthy?'), { size: 14, color: INK_SOFT, h: 22 });
      ids.canary = k.shape('roundRect', px + 1150, cy(3) - 40, 200, 80, 'Canary 10% → 100%', task);
      ids.end = k.shape('bpmnEnd', px + 1440, cy(3) - 28, 56, 56, '', { ...ev, stroke: CORAL });
      k.text(px + 1416, cy(3) + 34, 104, rt('Live'), { size: 14, color: INK_SOFT, align: 'center', h: 22 });
    });
    const go = (a: string, as: 'top' | 'right' | 'bottom' | 'left', b: string, bs: 'top' | 'right' | 'bottom' | 'left', label = '') =>
      k.connector({ id: ids[a], anchor: as }, { id: ids[b], anchor: bs }, { label, stroke: INK, endCap: 'triangle' });
    go('start', 'right', 'pr', 'left');
    go('pr', 'bottom', 'test', 'left');
    go('test', 'right', 'ok', 'left');
    go('ok', 'top', 'fix', 'bottom', 'no');
    go('fix', 'left', 'test', 'top');
    go('ok', 'right', 'build', 'left', 'yes');
    go('build', 'bottom', 'stage', 'left');
    go('stage', 'right', 'soak', 'left');
    go('soak', 'right', 'healthy', 'left');
    go('healthy', 'bottom', 'canary', 'top', 'yes');
    go('healthy', 'top', 'fix', 'right', 'no');
    go('canary', 'right', 'end', 'left');
    return k.done();
  },
};

export const bugTriage: TemplateDef = {
  id: 'bug-triage',
  name: 'Bug triage board',
  description: 'A kanban for incoming bugs, from new to fixed, with a severity guide everyone agrees on.',
  categories: ['engineering', 'agile'],
  keywords: ['bug triage', 'bugs', 'issues', 'defects', 'bug tracker', 'kanban', 'severity', 'qa', 'quality'],
  build(newId) {
    const k = new Kit(newId);
    const colW = 280;
    const columns: KanbanColumnSpec[] = [
      {
        title: 'New',
        color: HEAD.gray,
        items: [
          { card: 'Export cuts off long boards', desc: 'Reported by 3 teams', color: CORAL },
          { card: 'Typo on the pricing page', desc: 'Found by support', color: INK_SOFT },
        ],
      },
      {
        title: 'Confirmed',
        status: 'todo',
        color: HEAD.amber,
        items: [
          { card: 'S2 · Comments vanish on refresh', desc: 'Safari 17, slow network', color: AMBER },
          { card: 'S3 · Zoom jumps on trackpads', desc: 'Windows only', color: SKY },
        ],
      },
      { title: 'Fixing', status: 'doing', wip: 3, color: HEAD.sky, items: [{ card: 'S1 · Login loop for SSO users', desc: 'Hotfix in review', color: CORAL }] },
      { title: 'Fixed', status: 'done', color: HEAD.mint, items: [{ card: 'S3 · Sticky colors in dark mode', desc: 'Shipped in 4.2.1', color: MINT }] },
    ];
    const kb = kanbanSize(colW, columns);
    const sideW = 520;
    const guideRows = [
      { h: 44, cells: ['Level', 'What it means', 'Respond'] },
      { h: 56, cells: [{ t: 'S1', f: HEAD.coral }, 'Outage or data loss', 'Within 1 hour'] },
      { h: 56, cells: [{ t: 'S2', f: HEAD.amber }, 'Major feature broken', 'Same day'] },
      { h: 56, cells: [{ t: 'S3', f: HEAD.sky }, 'Annoying, workaround exists', 'This sprint'] },
      { h: 56, cells: [{ t: 'S4', f: HEAD.gray }, 'Cosmetic', 'Backlog'] },
    ];
    // Room under the board: cards measure themselves on insert and the board grows to fit.
    const bodyH = Math.max(kb.h + 40, 64 + 268 + 24);
    const W = 48 + kb.w + 24 + sideW + 48;
    k.frame('Bug triage', W, 160 + bodyH + 48);
    k.header('Bug triage', 'Triage new bugs daily: confirm, give a severity, then move them along. Cards change status as they move.', W);
    k.kanban(48, 160, 'Bugs', colW, columns);
    const sx = 48 + kb.w + 24;
    const y = k.section(sx, 160, sideW, bodyH, 'Severity guide', TINT.gray);
    k.table(sx + 24, y, [80, 248, 144], guideRows);
    return k.done();
  },
};

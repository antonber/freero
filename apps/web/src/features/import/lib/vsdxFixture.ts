// Hand-made Visio packages for tests and manual checks: a few parts written the way the VSDX
// format lays them out (document, pages, masters, media and their relationships), zipped. Only
// imported by tests (and scripts that write fixture files); never by the app.

const VISIO_NS = 'http://schemas.microsoft.com/office/visio/2012/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL = 'http://schemas.microsoft.com/visio/2010/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

export interface FixturePage {
  name: string;
  /** `<Shape>` elements. */
  shapes: string;
  /** `<Connect>` elements. */
  connects?: string;
  background?: boolean;
  /** Extra relationships of the page part (pictures): id → target relative to the page. */
  rels?: Array<{ id: string; target: string; external?: boolean }>;
}

export interface FixtureSpec {
  pages: FixturePage[];
  /** Stencil shapes: their universal name and `<Shape>` content. */
  masters?: Array<{ id: string; name: string; shapes: string }>;
  /** `<StyleSheet>` elements. */
  styles?: string;
  /** Package path → bytes (visio/media/image1.png). */
  media?: Record<string, Uint8Array>;
}

const rels = (items: Array<{ id: string; type: string; target: string; external?: boolean }>) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG_REL}">${items
    .map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"${r.external ? ' TargetMode="External"' : ''}/>`)
    .join('')}</Relationships>`;

/** A `.vsdx` package for `spec`. */
export async function buildVsdx(spec: FixtureSpec): Promise<Uint8Array> {
  const files: Array<[string, string | Uint8Array]> = [];
  files.push([
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/></Types>`,
  ]);
  files.push(['_rels/.rels', rels([{ id: 'rId1', type: `${REL}/document`, target: 'visio/document.xml' }])]);
  files.push(['visio/document.xml', `<?xml version="1.0" encoding="UTF-8"?><VisioDocument xmlns="${VISIO_NS}" xmlns:r="${R_NS}"><StyleSheets>${spec.styles ?? ''}</StyleSheets></VisioDocument>`]);
  const docRels = [{ id: 'rId1', type: `${REL}/pages`, target: 'pages/pages.xml' }];
  if (spec.masters?.length) docRels.push({ id: 'rId2', type: `${REL}/masters`, target: 'masters/masters.xml' });
  files.push(['visio/_rels/document.xml.rels', rels(docRels)]);

  if (spec.masters?.length) {
    files.push([
      'visio/masters/masters.xml',
      `<?xml version="1.0" encoding="UTF-8"?><Masters xmlns="${VISIO_NS}" xmlns:r="${R_NS}">${spec.masters.map((m, i) => `<Master ID="${m.id}" NameU="${m.name}" Name="${m.name}"><Rel r:id="rId${i + 1}"/></Master>`).join('')}</Masters>`,
    ]);
    files.push(['visio/masters/_rels/masters.xml.rels', rels(spec.masters.map((_, i) => ({ id: `rId${i + 1}`, type: `${REL}/master`, target: `master${i + 1}.xml` })))]);
    spec.masters.forEach((m, i) =>
      files.push([`visio/masters/master${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8"?><MasterContents xmlns="${VISIO_NS}" xmlns:r="${R_NS}"><Shapes>${m.shapes}</Shapes></MasterContents>`]),
    );
  }

  files.push([
    'visio/pages/pages.xml',
    `<?xml version="1.0" encoding="UTF-8"?><Pages xmlns="${VISIO_NS}" xmlns:r="${R_NS}">${spec.pages
      .map(
        (p, i) =>
          `<Page ID="${i}" NameU="${p.name}" Name="${p.name}"${p.background ? ' Background="1"' : ''}><PageSheet><Cell N="PageWidth" V="8.5"/><Cell N="PageHeight" V="11"/></PageSheet><Rel r:id="rId${i + 1}"/></Page>`,
      )
      .join('')}</Pages>`,
  ]);
  files.push(['visio/pages/_rels/pages.xml.rels', rels(spec.pages.map((_, i) => ({ id: `rId${i + 1}`, type: `${REL}/page`, target: `page${i + 1}.xml` })))]);
  spec.pages.forEach((p, i) => {
    files.push([
      `visio/pages/page${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><PageContents xmlns="${VISIO_NS}" xmlns:r="${R_NS}"><Shapes>${p.shapes}</Shapes>${p.connects ? `<Connects>${p.connects}</Connects>` : ''}</PageContents>`,
    ]);
    if (p.rels?.length)
      files.push([`visio/pages/_rels/page${i + 1}.xml.rels`, rels(p.rels.map((r) => ({ ...r, type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image' })))]);
  });
  for (const [path, bytes] of Object.entries(spec.media ?? {})) files.push([path, bytes]);
  return zipOf(files);
}

/** `<Cell N=… V=…/>` for each entry. */
export const cells = (c: Record<string, string | number>) =>
  Object.entries(c)
    .map(([n, v]) => `<Cell N="${n}" V="${v}"/>`)
    .join('');

/** Geometry rows as `[type, { X, Y, … }]`. */
export const geometry = (rows: Array<[string, Record<string, number>]>, ix = 0, extra = '') =>
  `<Section N="Geometry" IX="${ix}">${extra}${rows.map(([t, c], i) => `<Row T="${t}" IX="${i + 1}">${cells(c)}</Row>`).join('')}</Section>`;

/** A rectangle's geometry for a `w` × `h` box. */
export const rectGeometry = (w: number, h: number) =>
  geometry([
    ['MoveTo', { X: 0, Y: 0 }],
    ['LineTo', { X: w, Y: 0 }],
    ['LineTo', { X: w, Y: h }],
    ['LineTo', { X: 0, Y: h }],
    ['LineTo', { X: 0, Y: 0 }],
  ]);

// ------------------------------------------------------------------------------------ zip

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

async function deflate(b: Uint8Array): Promise<Uint8Array> {
  const input = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(c) {
      c.enqueue(b.slice());
      c.close();
    },
  });
  const reader = input.pipeThrough(new CompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A ZIP of `files` (deflated unless `store`). */
export async function zipOf(files: Array<[string, string | Uint8Array]>, opts: { store?: boolean } = {}): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const body = opts.store ? data : await deflate(data);
    const n = enc.encode(name);
    const head = new Uint8Array(30 + n.length);
    const v = new DataView(head.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(8, opts.store ? 0 : 8, true);
    v.setUint32(14, crc32(data), true);
    v.setUint32(18, body.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, n.length, true);
    head.set(n, 30);
    const cd = new Uint8Array(46 + n.length);
    const w = new DataView(cd.buffer);
    w.setUint32(0, 0x02014b50, true);
    w.setUint16(4, 20, true);
    w.setUint16(6, 20, true);
    w.setUint16(10, opts.store ? 0 : 8, true);
    w.setUint32(16, crc32(data), true);
    w.setUint32(20, body.length, true);
    w.setUint32(24, data.length, true);
    w.setUint16(28, n.length, true);
    w.setUint32(42, offset, true);
    cd.set(n, 46);
    local.push(head, body);
    central.push(cd);
    offset += head.length + body.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true);
  e.setUint32(16, offset, true);
  const all = [...local, ...central, end];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

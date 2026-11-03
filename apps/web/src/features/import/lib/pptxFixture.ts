// Hand-made PowerPoint packages for tests and manual checks: the parts a deck is made of (the
// presentation, slides, one layout and master, a theme, notes slides, media and their
// relationships), written the way the Office Open XML format lays them out, and zipped. Only
// imported by tests (and scripts that write fixture files); never by the app.
import { zipOf } from './vsdxFixture';

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const NS = `xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"`;
const T = (name: string) => `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${name}`;

const EMU = 9525;
const e = (px: number) => Math.round(px * EMU);

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FixtureSlide {
  /** Shapes in the slide's tree (`sp`, `pic`, `graphicFrame`, … made with the helpers below). */
  shapes: string;
  /** Pictures and other parts the slide refers to: id → package path (or a URL when external). */
  rels?: Array<{ id: string; type: 'image' | 'chart'; target: string; external?: boolean }>;
  notes?: string;
  hidden?: boolean;
  /** `<p:bg>` content. */
  background?: string;
}

export interface PptxSpec {
  slides: FixtureSlide[];
  /** Slide size in board units (default 1280 × 720). */
  size?: { w: number; h: number };
  /** Shapes of the layout (placeholders the slides inherit positions from, or artwork). */
  layoutShapes?: string;
  /** Shapes of the master. */
  masterShapes?: string;
  /** Package path → bytes (ppt/media/image1.png). */
  media?: Record<string, Uint8Array>;
  /** The deck lists its slides in this order of their part numbers (default 1..n). */
  order?: number[];
}

const xfrm = (b: Box, attrs = '') => `<a:xfrm${attrs}><a:off x="${e(b.x)}" y="${e(b.y)}"/><a:ext cx="${e(b.w)}" cy="${e(b.h)}"/></a:xfrm>`;

/** A paragraph: runs as `[text, rPr attributes, colour?]` or plain text. */
export function para(runs: Array<string | [string, string?, string?]>, pPr = ''): string {
  return `<a:p>${pPr ? `<a:pPr ${pPr}/>` : ''}${runs
    .map((r) => {
      const [t, attrs, color] = typeof r === 'string' ? [r] : r;
      const fill = color ? `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` : '';
      return `<a:r><a:rPr lang="en-US"${attrs ? ` ${attrs}` : ''}${fill ? `>${fill}</a:rPr>` : '/>'}<a:t>${t}</a:t></a:r>`;
    })
    .join('')}</a:p>`;
}

/** A shape (`p:sp`): a placeholder (`ph`), a text box, or a preset shape with fill / line / style. */
export function sp(
  id: number,
  o: {
    box?: Box;
    ph?: { type?: string; idx?: number };
    textBox?: boolean;
    geom?: string;
    fill?: string;
    line?: string;
    style?: boolean;
    paras?: string;
    anchor?: string;
    rot?: number;
  },
): string {
  const ph = o.ph ? `<p:ph${o.ph.type ? ` type="${o.ph.type}"` : ''}${o.ph.idx !== undefined ? ` idx="${o.ph.idx}"` : ''}/>` : '';
  const spPr = `<p:spPr>${o.box ? xfrm(o.box, o.rot ? ` rot="${o.rot * 60000}"` : '') : ''}${o.geom || !o.ph ? `<a:prstGeom prst="${o.geom ?? 'rect'}"><a:avLst/></a:prstGeom>` : ''}${
    o.fill ? `<a:solidFill>${o.fill.startsWith('scheme:') ? `<a:schemeClr val="${o.fill.slice(7)}"/>` : `<a:srgbClr val="${o.fill}"/>`}</a:solidFill>` : ''
  }${o.line ? `<a:ln w="${e(2)}"><a:solidFill><a:srgbClr val="${o.line}"/></a:solidFill></a:ln>` : ''}</p:spPr>`;
  const style = o.style
    ? '<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>'
    : '';
  const body = o.paras !== undefined ? `<p:txBody><a:bodyPr${o.anchor ? ` anchor="${o.anchor}"` : ''}/><a:lstStyle/>${o.paras}</p:txBody>` : '';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr${o.textBox ? ' txBox="1"' : ''}/><p:nvPr>${ph}</p:nvPr></p:nvSpPr>${spPr}${style}${body}</p:sp>`;
}

/** A line between two points, glued to shapes by their ids when given. */
export function cxn(id: number, from: { x: number; y: number }, to: { x: number; y: number }, glue: { start?: number; end?: number } = {}): string {
  const box = { x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), w: Math.abs(to.x - from.x), h: Math.abs(to.y - from.y) };
  const flips = `${to.x < from.x ? ' flipH="1"' : ''}${to.y < from.y ? ' flipV="1"' : ''}`;
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="Line ${id}"/><p:cNvCxnSpPr>${glue.start !== undefined ? `<a:stCxn id="${glue.start}" idx="3"/>` : ''}${
    glue.end !== undefined ? `<a:endCxn id="${glue.end}" idx="1"/>` : ''
  }</p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(box, flips)}<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom><a:ln w="${e(2)}"><a:solidFill><a:srgbClr val="333333"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>`;
}

/** A picture from relationship `rId`, cropped by `crop` (fractions l, t, r, b). */
export function pic(id: number, rId: string, box: Box, o: { crop?: { l: number; t: number; r: number; b: number }; descr?: string; link?: boolean } = {}): string {
  const c = o.crop ? `<a:srcRect l="${o.crop.l * 100000}" t="${o.crop.t * 100000}" r="${o.crop.r * 100000}" b="${o.crop.b * 100000}"/>` : '';
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}"${o.descr ? ` descr="${o.descr}"` : ''}/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip ${o.link ? 'r:link' : 'r:embed'}="${rId}"/>${c}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(box)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

/** A table of `rows` (cell texts), the first row a header. */
export function table(id: number, box: Box, rows: string[][], fills: Record<string, string> = {}): string {
  const cols = rows[0].length;
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${e(box.x)}" y="${e(box.y)}"/><a:ext cx="${e(box.w)}" cy="${e(box.h)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid>${Array.from(
    { length: cols },
    () => `<a:gridCol w="${e(box.w / cols)}"/>`,
  ).join('')}</a:tblGrid>${rows
    .map(
      (r, ri) =>
        `<a:tr h="${e(box.h / rows.length)}">${r
          .map((t, ci) => {
            const f = fills[`${ri}:${ci}`];
            return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${para([t])}</a:txBody><a:tcPr>${f ? `<a:solidFill><a:srgbClr val="${f}"/></a:solidFill>` : ''}</a:tcPr></a:tc>`;
          })
          .join('')}</a:tr>`,
    )
    .join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

/** A chart (Freero has no counterpart: it becomes a labelled box). */
export function chart(id: number, rId: string, box: Box): string {
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Chart ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${e(box.x)}" y="${e(box.y)}"/><a:ext cx="${e(box.w)}" cy="${e(box.h)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="${rId}"/></a:graphicData></a:graphic></p:graphicFrame>`;
}

const rels = (items: Array<{ id: string; type: string; target: string; external?: boolean }>) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG}">${items
    .map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"${r.external ? ' TargetMode="External"' : ''}/>`)
    .join('')}</Relationships>`;

const tree = (shapes: string) =>
  `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld>`;

const THEME = `<?xml version="1.0" encoding="UTF-8"?><a:theme xmlns:a="${A}" name="Fixture"><a:themeElements><a:clrScheme name="Fixture"><a:dk1><a:srgbClr val="1B1A2E"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="2E2D4A"/></a:dk2><a:lt2><a:srgbClr val="EEEEF4"/></a:lt2><a:accent1><a:srgbClr val="2F7D6D"/></a:accent1><a:accent2><a:srgbClr val="D9822B"/></a:accent2><a:accent3><a:srgbClr val="5468C4"/></a:accent3><a:accent4><a:srgbClr val="B5446E"/></a:accent4><a:accent5><a:srgbClr val="7A9A3A"/></a:accent5><a:accent6><a:srgbClr val="8E6CC0"/></a:accent6><a:hlink><a:srgbClr val="2F5FD0"/></a:hlink><a:folHlink><a:srgbClr val="7A4FB0"/></a:folHlink></a:clrScheme><a:fontScheme name="Fixture"><a:majorFont><a:latin typeface="Georgia"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;

/** A `.pptx` package for `spec`. */
export async function buildPptx(spec: PptxSpec): Promise<Uint8Array> {
  const size = spec.size ?? { w: 1280, h: 720 };
  const n = spec.slides.length;
  const order = spec.order ?? spec.slides.map((_, i) => i + 1);
  const files: Array<[string, string | Uint8Array]> = [];
  files.push([
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`,
  ]);
  files.push(['_rels/.rels', rels([{ id: 'rId1', type: T('officeDocument'), target: 'ppt/presentation.xml' }])]);
  files.push([
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rIdM"/></p:sldMasterIdLst><p:sldIdLst>${order
      .map((k, i) => `<p:sldId id="${256 + i}" r:id="rIdS${k}"/>`)
      .join('')}</p:sldIdLst><p:sldSz cx="${e(size.w)}" cy="${e(size.h)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
  ]);
  files.push([
    'ppt/_rels/presentation.xml.rels',
    rels([
      { id: 'rIdM', type: T('slideMaster'), target: 'slideMasters/slideMaster1.xml' },
      ...Array.from({ length: n }, (_, i) => ({ id: `rIdS${i + 1}`, type: T('slide'), target: `slides/slide${i + 1}.xml` })),
    ]),
  ]);
  files.push([
    'ppt/slideMasters/slideMaster1.xml',
    `<?xml version="1.0" encoding="UTF-8"?><p:sldMaster ${NS}>${tree(
      sp(2, { ph: { type: 'title' }, box: { x: 64, y: 32, w: size.w - 128, h: 120 } }) + sp(3, { ph: { type: 'body', idx: 1 }, box: { x: 64, y: 180, w: size.w - 128, h: size.h - 240 } }) + (spec.masterShapes ?? ''),
    )}<p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:buChar char="•"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`,
  ]);
  files.push([
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    rels([
      { id: 'rId1', type: T('slideLayout'), target: '../slideLayouts/slideLayout1.xml' },
      { id: 'rId2', type: T('theme'), target: '../theme/theme1.xml' },
      ...Object.keys(spec.media ?? {}).map((path, i) => ({ id: `rIdImg${i + 1}`, type: T('image'), target: `../${path.replace(/^ppt\//, '')}` })),
    ]),
  ]);
  files.push(['ppt/theme/theme1.xml', THEME]);
  files.push(['ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0" encoding="UTF-8"?><p:sldLayout ${NS}>${tree(spec.layoutShapes ?? '')}</p:sldLayout>`]);
  files.push(['ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([{ id: 'rId1', type: T('slideMaster'), target: '../slideMasters/slideMaster1.xml' }])]);
  spec.slides.forEach((s, i) => {
    const k = i + 1;
    const bg = s.background ? `<p:bg>${s.background}</p:bg>` : '';
    files.push([`ppt/slides/slide${k}.xml`, `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS}${s.hidden ? ' show="0"' : ''}>${tree(s.shapes).replace('<p:cSld>', `<p:cSld>${bg}`)}</p:sld>`]);
    const r = [{ id: 'rIdL', type: T('slideLayout'), target: '../slideLayouts/slideLayout1.xml' } as { id: string; type: string; target: string; external?: boolean }];
    if (s.notes !== undefined) r.push({ id: 'rIdN', type: T('notesSlide'), target: `../notesSlides/notesSlide${k}.xml` });
    for (const x of s.rels ?? []) r.push({ id: x.id, type: T(x.type), target: x.target, external: x.external });
    files.push([`ppt/slides/_rels/slide${k}.xml.rels`, rels(r)]);
    if (s.notes !== undefined)
      files.push([
        `ppt/notesSlides/notesSlide${k}.xml`,
        `<?xml version="1.0" encoding="UTF-8"?><p:notes ${NS}>${tree(sp(2, { ph: { type: 'sldImg' } }) + sp(3, { ph: { type: 'body', idx: 1 }, paras: s.notes.split('\n').map((l) => para([l])).join('') }))}</p:notes>`,
      ]);
  });
  for (const [path, bytes] of Object.entries(spec.media ?? {})) files.push([path, bytes]);
  return zipOf(files);
}

/** A tiny real PNG (w × h of one colour), for pictures in fixtures. */
export async function pngOf(w: number, h: number, rgb: [number, number, number]): Promise<Uint8Array> {
  const row = new Uint8Array(1 + w * 3);
  for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3);
  const raw = new Uint8Array(row.length * h);
  for (let y = 0; y < h; y++) raw.set(row, y * row.length);
  const zlib = async (b: Uint8Array) => {
    const s = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(c) {
        c.enqueue(b.slice());
        c.close();
      },
    }).pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  };
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, w);
  hv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', await zlib(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

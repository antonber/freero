// Web-font CSS for offscreen exports (html-to-image's `fontEmbedCSS`).
//
// Left to itself, html-to-image reads every document stylesheet's cssRules; the cross-origin
// web-font stylesheet throws on that and it logs console errors on every export. Instead we
// build the @font-face CSS ourselves: same-origin sheets are read directly, cross-origin ones are
// fetched (font CDNs answer CORS), and only the faces the exported node actually uses (family +
// unicode-range of its text) are inlined as data URLs. Any failure → '' (export with installed
// fonts), silently. Everything is cached for the session.

interface Face {
  family: string;
  css: string;
  base: string;
  ranges: Array<[number, number]> | null;
}

const sheetText = new Map<string, Promise<string | null>>();
const dataUrls = new Map<string, Promise<string | null>>();

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '');

function fetchText(url: string): Promise<string | null> {
  let p = sheetText.get(url);
  if (!p) {
    p = fetch(url, { mode: 'cors' })
      .then((r) => (r.ok ? r.text() : null))
      .catch(() => null);
    sheetText.set(url, p);
  }
  return p;
}

function fetchDataUrl(url: string): Promise<string | null> {
  let p = dataUrls.get(url);
  if (!p) {
    p = fetch(url, { mode: 'cors' })
      .then((r) => (r.ok ? r.blob() : null))
      .then(
        (blob) =>
          blob &&
          new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          }),
      )
      .catch(() => null);
    dataUrls.set(url, p);
  }
  return p;
}

function parseRanges(value: string): Array<[number, number]> | null {
  if (!value.trim()) return null;
  const out: Array<[number, number]> = [];
  for (const part of value.split(',')) {
    const m = part.trim().match(/^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i);
    if (!m) continue;
    if (m[1].includes('?')) out.push([parseInt(m[1].replace(/\?/g, '0'), 16), parseInt(m[1].replace(/\?/g, 'F'), 16)]);
    else out.push([parseInt(m[1], 16), parseInt(m[2] ?? m[1], 16)]);
  }
  return out.length ? out : null;
}

function facesFromText(css: string, base: string): Face[] {
  const out: Face[] = [];
  for (const m of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const body = m[1];
    const family = body.match(/font-family\s*:\s*([^;]+)/i)?.[1];
    if (!family) continue;
    out.push({ family: unquote(family), css: `@font-face {${body}}`, base, ranges: parseRanges(body.match(/unicode-range\s*:\s*([^;]+)/i)?.[1] ?? '') });
  }
  return out;
}

async function allFaces(): Promise<Face[]> {
  const faces: Face[] = [];
  const remote: Array<Promise<void>> = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      rules = null; // cross-origin: fetch it below
    }
    if (rules) {
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        faces.push({
          family: unquote(rule.style.getPropertyValue('font-family')),
          css: rule.cssText,
          base: sheet.href ?? document.baseURI,
          ranges: parseRanges(rule.style.getPropertyValue('unicode-range')),
        });
      }
    } else if (sheet.href) {
      const href = sheet.href;
      remote.push(fetchText(href).then((t) => void (t && faces.push(...facesFromText(t, href)))));
    }
  }
  await Promise.all(remote);
  return faces;
}

function usedFamilies(node: Element): Set<string> {
  const out = new Set<string>();
  const visit = (el: Element) => {
    for (const f of getComputedStyle(el).fontFamily.split(',')) out.add(unquote(f));
    for (const c of Array.from(el.children)) visit(c);
  };
  visit(node);
  return out;
}

/** @font-face CSS (fonts inlined) for what `node` renders, or '' when unavailable. */
export async function fontEmbedCss(node: HTMLElement): Promise<string> {
  try {
    const families = usedFamilies(node);
    const text = (node.textContent ?? '').slice(0, 20000);
    const chars = new Set<number>();
    for (const ch of text) chars.add(ch.codePointAt(0)!);
    const covers = (f: Face) => !f.ranges || [...chars].some((c) => f.ranges!.some(([a, b]) => c >= a && c <= b));
    const faces = (await allFaces()).filter((f) => families.has(f.family) && covers(f));
    const blocks = await Promise.all(
      faces.map(async (f) => {
        let css = f.css;
        for (const m of f.css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
          if (m[1].startsWith('data:')) continue;
          const data = await fetchDataUrl(new URL(m[1], f.base).href);
          if (!data) return null; // a face we can't inline would make the renderer fetch it: drop it
          css = css.replace(m[0], `url(${data})`);
        }
        return css;
      }),
    );
    return blocks.filter(Boolean).join('\n');
  } catch {
    return '';
  }
}

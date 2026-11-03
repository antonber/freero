// Open Packaging Conventions: the part of Office files (Visio .vsdx, PowerPoint .pptx) that is the
// same for both — XML parts in a zip, joined by relationship parts (`_rels/<name>.rels`). Read from
// untrusted bytes: XML with a DOCTYPE is refused (no external entities, no entity expansion), a
// relationship never leads outside the package, and external ones are never followed.
import { ImportError } from './common';
import type { ZipPackage } from './zip';

export interface Rel {
  type: string;
  /** A package path (resolved), or the URL of an external relationship. */
  target: string;
  external: boolean;
}

/** Parses an XML part; `what` names the file for the person ("This Visio file …"). */
export function parseXml(text: string, what: string): Document {
  // No DTDs at all: nothing to resolve (external entities) and nothing to expand (billion laughs).
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ImportError(`This ${what} declares a DOCTYPE, which Freero doesn’t accept.`);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new ImportError(`This ${what} is damaged (a part of it is malformed XML).`);
  return doc;
}

export const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

/** `target` of a relationship of `from`, as a package path (`..` resolved; never outside the package). */
export function resolve(from: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : dirOf(from) + target).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

/** Child elements of `el` with local name `local` (namespace prefixes ignored). */
export const kids = (el: Element, local: string) => [...el.children].filter((c) => c.localName === local);
/** The first child named `local`, if any. */
export const kid = (el: Element | null | undefined, local: string): Element | null => (el ? ([...el.children].find((c) => c.localName === local) ?? null) : null);

/** A relationship id attribute (`r:id`, `r:embed`, `r:link`) of `el`. */
export function relAttr(el: Element, name: 'id' | 'embed' | 'link' = 'id'): string | null {
  for (const a of [...el.attributes]) if (a.localName === name && (a.prefix === 'r' || a.namespaceURI?.includes('relationships'))) return a.value;
  return null;
}

export class OpcPackage {
  private readonly relCache = new Map<string, Map<string, Rel>>();
  private readonly xmlCache = new Map<string, Document | null>();
  constructor(
    readonly zip: ZipPackage,
    private readonly what: string,
  ) {}

  /** A part as XML (parsed once), or null when the package has no such part. */
  async xml(path: string): Promise<Document | null> {
    if (this.xmlCache.has(path)) return this.xmlCache.get(path)!;
    const t = await this.zip.text(path);
    const doc = t === null ? null : parseXml(t, this.what);
    this.xmlCache.set(path, doc);
    return doc;
  }

  /** The relationships of the part at `path` (its `_rels/<name>.rels`), by id. */
  async rels(path: string): Promise<Map<string, Rel>> {
    const known = this.relCache.get(path);
    if (known) return known;
    const out = new Map<string, Rel>();
    const doc = await this.xml(`${dirOf(path)}_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`);
    for (const r of doc ? [...doc.getElementsByTagName('*')].filter((e) => e.localName === 'Relationship') : []) {
      const id = r.getAttribute('Id');
      const target = r.getAttribute('Target');
      if (!id || !target) continue;
      const external = r.getAttribute('TargetMode') === 'External';
      out.set(id, { type: r.getAttribute('Type') ?? '', target: external ? target : resolve(path, target), external });
    }
    this.relCache.set(path, out);
    return out;
  }

  /** The first internal relationship of `path` whose type ends with `suffix` (e.g. '/slideLayout'). */
  async relOfType(path: string, suffix: string): Promise<Rel | undefined> {
    return [...(await this.rels(path)).values()].find((r) => !r.external && r.type.endsWith(suffix));
  }
}

/** A picture's type by its first bytes (only those the board shows). */
export function sniffImage(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return null;
}

export function base64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

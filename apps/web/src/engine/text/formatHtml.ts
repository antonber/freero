// Whole-text formatting (when an element is selected but not being edited).
// Operates on RichText strings through a detached DOM, then re-sanitizes.
import type { FormatCommand, TextFormatState } from './session';
import { plainToRichText, richTextToPlain, sanitizeRichText } from './sanitize';

const INLINE: Record<string, string> = { bold: 'B', italic: 'I', underline: 'U', strike: 'S' };

function parse(html: string): HTMLDivElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      if ((n.textContent ?? '').trim()) out.push(n as Text);
    } else n.childNodes.forEach(walk);
  };
  walk(root);
  return out;
}

function hasAncestor(n: Node, root: Node, pred: (el: HTMLElement) => boolean): HTMLElement | null {
  let p = n.parentNode;
  while (p && p !== root) {
    if (p.nodeType === 1 && pred(p as HTMLElement)) return p as HTMLElement;
    p = p.parentNode;
  }
  return null;
}

function unwrapAll(root: HTMLElement, selector: string) {
  for (const el of Array.from(root.querySelectorAll(selector))) {
    const parent = el.parentNode!;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }
}

/** Wraps the inline content of each block (p, li) — or the whole root — in a new element. */
function wrapContent(root: HTMLElement, make: () => HTMLElement) {
  const blocks = Array.from(root.querySelectorAll('p, li'));
  const targets: HTMLElement[] = blocks.length ? (blocks as HTMLElement[]) : [root];
  for (const t of targets) {
    if (!t.textContent?.trim()) continue;
    const w = make();
    while (t.firstChild) w.appendChild(t.firstChild);
    t.appendChild(w);
  }
  // Loose inline content between blocks (e.g. "a<p>b</p>")
  if (blocks.length) {
    for (const n of Array.from(root.childNodes)) {
      if (n.nodeType === 3 && n.textContent?.trim()) {
        const w = make();
        root.insertBefore(w, n);
        w.appendChild(n);
      }
    }
  }
}

export function formatStateOfHtml(html: string): TextFormatState {
  const root = parse(html);
  const nodes = textNodes(root);
  const all = (pred: (el: HTMLElement) => boolean) => nodes.length > 0 && nodes.every((n) => !!hasAncestor(n, root, pred));
  const a = nodes.length ? hasAncestor(nodes[0], root, (el) => el.tagName === 'A') : null;
  return {
    bold: all((el) => el.tagName === 'B' || el.tagName === 'STRONG'),
    italic: all((el) => el.tagName === 'I' || el.tagName === 'EM'),
    underline: all((el) => el.tagName === 'U'),
    strike: all((el) => el.tagName === 'S'),
    bullets: !!root.querySelector('ul'),
    numbers: !!root.querySelector('ol'),
    link: a?.getAttribute('href') ?? null,
  };
}

function toLines(html: string): string[] {
  return richTextToPlain(html)
    .split('\n')
    .map((l) => l.replace(/^• /, ''));
}

/** Applies `cmd` to the whole rich text. `state` = current state (for toggles). */
export function applyFormatToHtml(html: string, cmd: FormatCommand, value?: string): string {
  const state = formatStateOfHtml(html);
  const root = parse(html);
  switch (cmd) {
    case 'bold':
    case 'italic':
    case 'underline':
    case 'strike': {
      const tag = INLINE[cmd];
      const on = !state[cmd];
      const sel = tag === 'B' ? 'b, strong' : tag === 'I' ? 'i, em' : tag === 'S' ? 's, strike, del' : 'u';
      unwrapAll(root, sel);
      if (on) wrapContent(root, () => document.createElement(tag.toLowerCase()));
      break;
    }
    case 'color':
    case 'highlight': {
      const prop = cmd === 'color' ? 'color' : 'backgroundColor';
      for (const s of Array.from(root.querySelectorAll('span'))) (s as HTMLElement).style[prop] = '';
      if (value && value !== 'transparent') {
        wrapContent(root, () => {
          const s = document.createElement('span');
          s.style[prop] = value;
          return s;
        });
      }
      break;
    }
    case 'link': {
      unwrapAll(root, 'a');
      if (value) {
        wrapContent(root, () => {
          const a = document.createElement('a');
          a.setAttribute('href', value);
          return a;
        });
      }
      break;
    }
    case 'bullets':
    case 'numbers': {
      const listTag = cmd === 'bullets' ? 'ul' : 'ol';
      const isOn = cmd === 'bullets' ? state.bullets : state.numbers;
      const lines = toLines(html);
      if (isOn) return sanitizeRichText(plainToRichText(lines.join('\n')));
      const items = lines.map((l) => `<li>${plainToRichText(l) || '<br>'}</li>`).join('');
      return sanitizeRichText(`<${listTag}>${items}</${listTag}>`);
    }
    case 'clear':
      return sanitizeRichText(plainToRichText(toLines(html).join('\n')));
  }
  return sanitizeRichText(root.innerHTML);
}

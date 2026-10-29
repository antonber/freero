// The syntax highlighter, loaded on demand (import('./highlighter')) so boards without code never
// download it. lowlight runs highlight.js grammars and returns a syntax TREE (hast), not HTML: we
// turn it into lines of text runs with class names, which React renders as escaped text. No HTML
// string is ever built from a code block, so nothing in one can become markup.
import { createLowlight } from 'lowlight';
import type { Element, ElementContent, Root } from 'hast';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { AUTO, LANGUAGES } from './languages';
import type { HighlightResult, Run } from './tokens';

const lowlight = createLowlight({
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, markdown, php, python, ruby, rust, scss, sql, swift, typescript, xml, yaml,
});
const SUBSET = LANGUAGES.map((l) => l.id);

/** Token classes we keep: highlight.js scope names only (`hljs-keyword`, `hljs-title`, …). */
const SCOPE = /^hljs-[a-z][a-z0-9_-]{0,40}$/;

function classesOf(el: Element): string[] {
  const raw: unknown = el.properties?.className;
  const list: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\s+/) : [];
  return list.filter((c): c is string => typeof c === 'string' && SCOPE.test(c));
}

/** Flattens the tree into runs (text + the scopes around it), split into lines. */
export function toLines(tree: Root): Run[][] {
  const lines: Run[][] = [[]];
  const walk = (nodes: ElementContent[] | Root['children'], scopes: string[]) => {
    for (const n of nodes) {
      if (n.type === 'text') {
        const parts = n.value.split('\n');
        parts.forEach((part, i) => {
          if (i > 0) lines.push([]);
          if (part) lines[lines.length - 1].push({ text: part, scopes });
        });
      } else if (n.type === 'element') {
        const own = classesOf(n);
        walk(n.children, own.length ? [...scopes, ...own] : scopes);
      }
    }
  };
  walk(tree.children, []);
  return lines;
}

/** Highlights `code` as `language` ('auto' guesses among the known ones; unknown = plain). */
export function highlight(code: string, language: string): HighlightResult {
  try {
    if (language === AUTO) {
      const tree = lowlight.highlightAuto(code, { subset: SUBSET });
      return { lines: toLines(tree), detected: typeof tree.data?.language === 'string' ? tree.data.language : null };
    }
    if (lowlight.registered(language)) return { lines: toLines(lowlight.highlight(language, code)), detected: language };
  } catch {
    // A grammar that throws on odd input: show the text plain rather than nothing.
  }
  return { lines: code.split('\n').map((t) => (t ? [{ text: t, scopes: [] }] : [])), detected: null };
}

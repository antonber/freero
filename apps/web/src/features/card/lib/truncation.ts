// Is a card's line-clamped description cut off? Asked of the browser's own layout (scrollHeight
// beyond clientHeight), never of a measurement of ours: that is what the person sees.
//
// Cheap on big boards: one ResizeObserver for every card (it reports after layout, a box at a
// time only when its size changes — a resize, a kanban column's new width; zooming scales the
// world and changes no box), a text change asks once in the next frame, and fonts finishing to
// load ask every watched box once. Each pass reads every box first and only then reports, so a
// thousand cards mounting together cost one layout, not one each.
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

type Report = (cut: boolean) => void;

const watched = new Map<Element, Report>();
const pending = new Set<Element>();
let scheduled = false;
let observer: ResizeObserver | null | undefined;
let fontsHooked = false;

const isCut = (el: Element) => el.scrollHeight - el.clientHeight > 1;

function measure(els: Iterable<Element>) {
  const results: Array<[Report, boolean]> = [];
  for (const el of els) {
    const report = watched.get(el);
    if (report && el.isConnected) results.push([report, isCut(el)]);
  }
  for (const [report, cut] of results) report(cut);
}

const nextFrame = (cb: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(cb, 16));

function ask(el: Element) {
  pending.add(el);
  if (scheduled) return;
  scheduled = true;
  nextFrame(() => {
    scheduled = false;
    const els = [...pending];
    pending.clear();
    measure(els);
  });
}

function resizeObserver(): ResizeObserver | null {
  if (observer === undefined) observer = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => measure(entries.map((e) => e.target))) : null;
  return observer;
}

function hookFonts() {
  if (fontsHooked || typeof document === 'undefined' || !document.fonts) return;
  fontsHooked = true;
  document.fonts.addEventListener?.('loadingdone', () => watched.forEach((_, el) => ask(el)));
}

function watch(el: Element, report: Report) {
  watched.set(el, report);
  resizeObserver()?.observe(el);
  hookFonts();
}

function unwatch(el: Element) {
  watched.delete(el);
  pending.delete(el);
  resizeObserver()?.unobserve(el);
}

/**
 * Whether the element `ref` holds shows less than its content (a line clamp cut it). `content`
 * is what it shows: a change asks again. The element may come and go (no description, then one).
 */
export function useTruncated(ref: RefObject<HTMLElement | null>, content: string): boolean {
  const [cut, setCut] = useState(false);
  const seen = useRef<HTMLElement | null>(null);
  // After every render, a comparison: follow the node without a second render to learn it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === seen.current) return;
    if (seen.current) unwatch(seen.current);
    seen.current = el;
    if (el) watch(el, setCut);
    else setCut(false);
  });
  useLayoutEffect(
    () => () => {
      if (seen.current) unwatch(seen.current);
      seen.current = null;
    },
    [],
  );
  useLayoutEffect(() => {
    if (ref.current) ask(ref.current);
  }, [ref, content]);
  return cut;
}

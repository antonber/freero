// Clickjacking guard for a board embedded on another site (#2): before editing starts, ask the
// browser whether this frame is actually visible — not covered by the page around it, not made
// transparent, not transformed (IntersectionObserver v2 `trackVisibility`, Chromium). Browsers
// that can't tell let the click through: the click itself, on Freero's own button inside the
// frame, is still required, and the embedder can always make the embed read-only.

interface VisibilityEntry extends IntersectionObserverEntry {
  isVisible?: boolean;
}

/** Resolves true unless the browser says `el` is covered or altered right now. */
export function frameIsUncovered(el: Element): Promise<boolean> {
  if (window.parent === window) return Promise.resolve(true);
  const supported = typeof IntersectionObserver !== 'undefined' && 'isVisible' in IntersectionObserverEntry.prototype;
  if (!supported) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      io.disconnect();
      resolve(v);
    };
    const io = new IntersectionObserver((entries) => finish((entries[entries.length - 1] as VisibilityEntry).isVisible !== false), {
      trackVisibility: true,
      delay: 100,
    } as IntersectionObserverInit);
    io.observe(el);
    // No answer (a browser quirk): don't block someone who may edit.
    setTimeout(() => finish(true), 1000);
  });
}

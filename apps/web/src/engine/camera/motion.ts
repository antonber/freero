// The OS "reduce motion" setting. Camera moves jump instead of gliding (setCamera, zoom steps, fit,
// Tab-walking) and following someone snaps to their view: large-field motion is what triggers
// vestibular discomfort, so it is the camera that obeys, not just CSS animations (ui/base.css).
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

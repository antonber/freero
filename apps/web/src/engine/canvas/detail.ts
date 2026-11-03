// Low detail on the live canvas (#131). Zoomed out far enough that text is a few pixels tall, the
// world layer paints the element types that know how (ElementDefinition.lowDetail: a sticky's
// paper, a shape's outline, a line's straight run, a picture's average colour) onto shared
// canvases in render order (LowDetailLayer.tsx) instead of drawing their full components: no
// text layout, no store queries, no DOM per item. Paint only: the doc, hit-testing, selection,
// exports and thumbnails (ElementFrame, RenderModeContext 'export'), the live regions and the
// board outline never see it.
//
// The switch has hysteresis, so a zoom resting near the threshold (a trackpad settling, a camera
// glide ending) never flickers between the two: it turns on below `enter` and off again only above
// `exit`. It is instant both ways (no animation, so reduced motion has nothing to reduce), and the
// low-detail box is the element's own box, so switching back never moves anything.

/** Zoom thresholds of low detail: on below `enter`, off again above `exit`. */
export const LOW_DETAIL_ZOOM = { enter: 0.18, exit: 0.22 } as const;

/**
 * An item at least this big on screen (px, its longer side, at the quantized zoom) keeps its full
 * drawing even in low detail: a huge sticky still reads when the board around it doesn't.
 */
export const LOW_DETAIL_MAX_PX = 160;

/** Whether the canvas is in low detail at `zoom`, given whether it was. */
export function nextLowDetail(was: boolean, zoom: number): boolean {
  return was ? zoom < LOW_DETAIL_ZOOM.exit : zoom < LOW_DETAIL_ZOOM.enter;
}

/** Whether an item `w` × `h` paints in low detail while the canvas is in low detail at quantized `zoom`. */
export function drawsLowDetail(lowDetail: boolean, w: number, h: number, zoom: number): boolean {
  return lowDetail && Math.max(w, h) * zoom < LOW_DETAIL_MAX_PX;
}

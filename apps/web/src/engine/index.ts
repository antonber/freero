// The ONLY import path for features and the app: `import { ... } from '@engine'`.
// Everything not exported here is engine-private.

export * from './api';

// Composition root component: <BoardEngine host={host} features={bundles} />
export { BoardEngine } from './BoardEngine';
// Groups `import.meta.glob` results from features/* into FeatureBundles.
export { collectFeatures } from './runtime/collectFeatures';

// Reactive hooks (valid inside BoardEngine). useEditor() is scoped to the
// calling feature automatically.
export {
  useEditor,
  useElement,
  useElements,
  useSelection,
  useSelectedElements,
  useCamera,
  useToolId,
  useToolOptions,
  useCollection,
  usePeers,
  useRole,
  useEditingId,
  useDock,
  // additive (see ARCHITECTURE.md "Engine contract additions")
  usePointer,
  useTextFormatState,
  useSettings,
  useCanEdit,
  useChromeHidden,
  useFormatToolbarRect,
  useFollowing,
  useEditingPart,
  useViewHidden,
  usePrivateCollection,
  useIsExporting,

} from './hooks';

// Renders an element's rich-text field; switches to the shared editor while editing.
export { ElementText } from './text/ElementText';
export type { ElementTextProps } from './text/ElementText';
// Sanitizes the RichText HTML subset (see @freero/shared RichText).
export { sanitizeRichText, richTextToPlain, plainToRichText, replaceInRichText, isSafeHref } from './text/sanitize';
export type { TextFormatState } from './text/session';
// [additive] Size of rich text exactly as <ElementText> renders it — for `normalize` (text boxes,
// card titles, mind-map pills). Cached; re-measured by the engine once web fonts load.
export { measureRichText } from './text/measure';
export type { MeasureTextOptions, MeasuredText } from './text/measure';
// [additive] Shared text-style format controls (font, size, color, highlight, marks, alignment)
// that text-bearing features compose in format.tsx; the feature owns the write (onChange).
export {
  MIXED,
  commonValue,
  parseFontSize,
  FONT_FAMILY_OPTIONS,
  TEXT_COLOR_PALETTE,
  TEXT_HIGHLIGHT_PALETTE,
  FontFamilyControl,
  FontSizeControl,
  TextColorControl,
  TextHighlightControl,
  TextMarkButtons,
  TextAlignControl,
} from './ui/TextStyleControls';
export type { Mixed, FontSizeValue, FontSizeOption, TextMark } from './ui/TextStyleControls';
// [additive] World point → element-local unrotated coordinates (what hitTest / distanceTo take).
export { worldToLocal } from './geometry/geometry';

// [additive] Test support: several real engine replicas of one board that sync on demand
// (prove concurrent writes converge). Tests only.
export { createTestBoard } from './testing';
export type { TestBoard, TestBoardOptions } from './testing';

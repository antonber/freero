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
  useToolGhost,
  useTextFormatState,
  useSettings,
  useCanEdit,
  useChromeHidden,
  useFormatToolbarRect,
  useFollowing,
  useLimits,
  useCursorsHidden,
  useEditingPart,
  useViewHidden,
  usePrivateCollection,
  useIsExporting,
  useElementsQuery,
  usePeople,

} from './hooks';

// [additive] A dock panel's header (title, search, filters): rendered in the dock's fixed strip
// beside its close button, so the panel's content scrolls below it, never under the button.
export { DockHeader } from './ui/DockHeader';
export type { DockHeaderProps } from './ui/DockHeader';

// [additive] A read-only board showing a given document state (version previews): its own local
// engine session, so panning it never touches the live board. Render inside a mounted board.
export { StaticBoardView } from './canvas/StaticBoardView';
export type { StaticBoardViewProps } from './canvas/StaticBoardView';

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
// [additive] An element type's name and icon (ElementDefinition.label / icon, with one fallback).
export { describeElementType, elementTypeDescription } from './editor/typeLabel';
export type { ElementTypeDescription } from './editor/typeLabel';
// [additive] World point → element-local unrotated coordinates (what hitTest / distanceTo take).
export { worldToLocal } from './geometry/geometry';

// [additive] Test support: several real engine replicas of one board that sync on demand
// (prove concurrent writes converge). Tests only.
export { createTestBoard } from './testing';
export type { TestBoard, TestBoardOptions } from './testing';

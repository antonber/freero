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
} from './hooks';

// Renders an element's rich-text field; switches to the shared editor while editing.
export { ElementText } from './text/ElementText';
export type { ElementTextProps } from './text/ElementText';
// Sanitizes the RichText HTML subset (see @freero/shared RichText).
export { sanitizeRichText, richTextToPlain, plainToRichText } from './text/sanitize';
export type { TextFormatState } from './text/session';

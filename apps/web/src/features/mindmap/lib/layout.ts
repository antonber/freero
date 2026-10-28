// The mind-map tidy-tree layout is @freero/shared's `layoutMindTree` (layout/mindtree.ts): the
// same function lays out maps inserted from structure on the server and in "Insert from text",
// so a map inserted there is already tidy here (mindmap.test.ts proves it).
import { layoutMindBranch, layoutMindTree, MIND_GAPS, type MindLayoutOptions } from '@freero/shared';

export const ROOT_GAP = MIND_GAPS.root;
export const LEVEL_GAP = MIND_GAPS.level;
export const SIBLING_GAP = MIND_GAPS.sibling;

export type LayoutOptions = MindLayoutOptions;

/** Positions of every node of the map rooted at `rootId` (the root itself stays put). */
export const layoutTree = layoutMindTree;

/**
 * Positions of `id`'s descendants relative to where `id` is now (its side inherited from its
 * parent): what a dragged branch looks like while it travels.
 */
export const layoutBranch = layoutMindBranch;

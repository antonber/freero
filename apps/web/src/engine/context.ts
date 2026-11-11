// React contexts: the engine core for a mounted board, and the feature scope of the subtree.
import { createContext, useContext, type ReactNode } from 'react';
import type { EngineCore } from './runtime/core';
import type { Backdrop } from './canvas/theme';

export const EngineContext = createContext<EngineCore | null>(null);

/** Name of the feature whose component is rendering (set by the engine around every feature component). */
export const ScopeContext = createContext<string>('engine');

export function useCore(): EngineCore {
  const core = useContext(EngineContext);
  if (!core) throw new Error('Engine hooks can only be used inside <BoardEngine>.');
  return core;
}

/**
 * App-owned UI the engine places in its chrome (`BoardEngineProps.topbarAccessory` top right,
 * `titleAccessory` beside the board's title), and the board's title as it is now: a rename made
 * outside the title field (a feature, the share dialog) arrives as a new host, which the title shows.
 */
export const AppChromeContext = createContext<{ topbarAccessory?: ReactNode; titleAccessory?: ReactNode; boardTitle?: string }>({});

/** 'export' while rendering offscreen for images/thumbnails: no editors, no selection UI. */
export const RenderModeContext = createContext<'live' | 'export'>('live');

/**
 * [additive] What a dark page shows behind the item being drawn (canvas/backdrop.ts): set around
 * each item on the live canvas only, null elsewhere (exports, previews, a light page).
 */
export const BackdropContext = createContext<Backdrop | null>(null);

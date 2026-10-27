// React contexts: the engine core for a mounted board, and the feature scope of the subtree.
import { createContext, useContext } from 'react';
import type { EngineCore } from './runtime/core';

export const EngineContext = createContext<EngineCore | null>(null);

/** Name of the feature whose component is rendering (set by the engine around every feature component). */
export const ScopeContext = createContext<string>('engine');

export function useCore(): EngineCore {
  const core = useContext(EngineContext);
  if (!core) throw new Error('Engine hooks can only be used inside <BoardEngine>.');
  return core;
}

/** 'export' while rendering offscreen for images/thumbnails: no editors, no selection UI. */
export const RenderModeContext = createContext<'live' | 'export'>('live');

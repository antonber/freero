// The board's frames in deck order with what is on each (the panels that list slides share this).
import { useMemo } from 'react';
import type { BoardElement, FrameElement } from '@freero/shared';
import { useElements } from '@engine';
import { isFrame, orderFrames } from './frames';

export function useSlides(): { frames: FrameElement[]; childrenOf: Map<string, BoardElement[]> } {
  const all = useElements();
  return useMemo(() => {
    const frames = orderFrames(all.filter(isFrame));
    const childrenOf = new Map<string, BoardElement[]>();
    for (const el of all) {
      if (!el.frameId || el.type === 'frame') continue;
      const list = childrenOf.get(el.frameId) ?? [];
      list.push(el);
      childrenOf.set(el.frameId, list);
    }
    return { frames, childrenOf };
  }, [all]);
}

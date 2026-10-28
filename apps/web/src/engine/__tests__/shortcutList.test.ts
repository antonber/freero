import { afterEach, describe, expect, it } from 'vitest';
import { Star } from 'lucide-react';
import type { Role } from '@freero/shared';
import type { EngineCore } from '../runtime/core';
import { bundle, makeCore } from './harness';

let core: EngineCore;
afterEach(() => core?.destroy());

const withFeature = (role: Role) =>
  (core = makeCore({
    role,
    bundles: [
      bundle('stars', {
        tools: [{ id: 'stars.tool', label: 'Star', icon: Star, shortcut: 'q', order: 5, placement: 'main' }],
        commands: [{ id: 'stars.jump', label: 'Jump to star', shortcut: 'mod+j', run: () => undefined }],
      }),
    ],
  }));

describe('shortcut reference source', () => {
  it("lists a feature's real bindings, folds alternative keys into one row, and hides what the role can't use", () => {
    const owner = withFeature('owner').editor.getShortcuts();
    expect(owner.find((s) => s.id === 'stars.jump')?.shortcuts).toEqual(['mod+j']);
    expect(owner.find((s) => s.id === 'stars.tool')?.shortcuts).toEqual(['q']);
    // Two engine commands both labelled Redo → one row with both keys, not two rows.
    const redo = owner.filter((s) => s.feature === 'engine' && s.label === 'Redo');
    expect(redo).toHaveLength(1);
    expect(redo[0].shortcuts).toEqual(expect.arrayContaining(['mod+shift+z', 'mod+y']));
    core.destroy();

    const viewer = withFeature('viewer').editor.getShortcuts();
    const ids = viewer.map((s) => s.id);
    expect(ids).not.toContain('stars.tool');
    expect(ids).not.toContain('stars.jump');
    expect(ids).not.toContain('engine.key.nudge');
    expect(ids).toContain('engine.zoomToFit');
  });
});

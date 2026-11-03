// The AI feature's own part of an action: landing an accepted preview on the board (the server
// asks the model and lays the result out; see apps/server/src/modules/ai/ai.test.ts).
import { afterEach, expect, it } from 'vitest';
import type { AiActionResponse, BoardElement } from '@freero/shared';
import { createTestBoard, type ElementDefinition, type FeatureBundle, type TestBoard } from '@engine';
import manifest from './feature';
import { applyPreview } from './lib/actions';

// Stand-ins for the frame (a container) and text elements a summary lands in and as.
const def = (type: string, extra: Partial<ElementDefinition> = {}) =>
  ({ type, label: { one: type, many: type }, icon: () => null, resize: 'free', defaults: () => ({ type, w: 100, h: 100 }), Component: () => null, ...extra }) as unknown as ElementDefinition;
const bundle: FeatureBundle = { manifest, elements: [def('frame', { container: true }), def('text')], tools: [], formats: [], panels: [], commands: [] };

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
});

it('a meeting summary that the server put below the frame’s contents grows the frame, joins it, and one undo takes both back', () => {
  board = createTestBoard({ users: ['ann'], features: [bundle] });
  const [ed] = board.editors('ai');
  const frameId = ed.create({ type: 'frame', x: 0, y: 0, w: 600, h: 400, title: 'Weekly sync' } as never)!;
  const note = { id: 'n1', type: 'text', x: 40, y: 420, w: 400, h: 160, rotation: 0, z: 1, createdBy: 'ann', createdAt: 1, updatedAt: 1, text: '<p>Summary</p>' } as unknown as BoardElement;
  const res = { task: 'summarize', target: 'preview', created: ['n1'], moved: [], bounds: { x: 40, y: 420, w: 400, h: 160 }, snapshot: { elements: [note], content: {} }, moves: [], summary: '', usage: { inputTokens: 0, outputTokens: 0 } } as AiActionResponse;

  const [id] = applyPreview(ed, res, { into: frameId });

  const frame = ed.getElement(frameId)!;
  expect(frame.y + frame.h).toBeGreaterThanOrEqual(420 + 160);
  expect(ed.getElement(id)?.frameId).toBe(frameId);
  ed.undo();
  expect(ed.getElement(id)).toBeUndefined();
  expect(ed.getElement(frameId)).toMatchObject({ h: 400 });
});

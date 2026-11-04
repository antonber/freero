// @vitest-environment jsdom
import { expect, it } from 'vitest';
import type { ImageElement } from '@freero/shared';
import { createTestBoard, type HostFigma, type NewElement } from '@engine';
import manifest from './feature';
import { refreshFromFigma } from './lib/frames';

it('refreshing a frame whose design grew taller swaps its picture in place, as wide and centred as it was, and leaves other pictures alone', async () => {
  const board = createTestBoard({ users: ['ada'], features: [manifest] });
  const [editor] = board.editors('figma');
  const asked: string[] = [];
  const figma: Partial<HostFigma> = {
    place: async (fileKey, nodeId) => {
      asked.push(`${fileKey}/${nodeId}`);
      return { url: '/uploads/new.png', w: 400, h: 1600, link: '', name: 'Cart' };
    },
  };
  (editor.host as { figma?: HostFigma }).figma = figma as HostFigma;
  const [fromFigma, plain] = editor.createMany([
    { type: 'image', src: '/uploads/old.png', naturalW: 400, naturalH: 800, alt: 'Cart', link: 'https://www.figma.com/design/MockCheckoutFile2026/Checkout?node-id=1-2', x: 100, y: 100, w: 200, h: 400 },
    { type: 'image', src: '/uploads/photo.png', naturalW: 400, naturalH: 800, alt: '', link: 'https://example.com', x: 500, y: 100, w: 200, h: 400 },
  ] as unknown as NewElement[]);

  await refreshFromFigma(editor, [fromFigma, plain]);

  expect(asked).toEqual(['MockCheckoutFile2026/1:2']);
  expect(editor.getElement<ImageElement>(fromFigma)).toMatchObject({ src: '/uploads/new.png', naturalW: 400, naturalH: 1600, x: 100, w: 200, h: 800, y: -100 });
  expect(editor.getElement<ImageElement>(plain)).toMatchObject({ src: '/uploads/photo.png', h: 400 });
});

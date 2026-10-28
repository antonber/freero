// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRemoteImageInliner } from '../editor/remoteImages';
import { makeHost } from './harness';

const PNG_BYTES = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

function node(...srcs: string[]) {
  const div = document.createElement('div');
  for (const src of srcs) {
    const img = document.createElement('img');
    img.src = src;
    div.appendChild(img);
  }
  return div;
}

afterEach(() => vi.unstubAllGlobals());

describe('exports include images linked from other sites', () => {
  it('an image whose host refuses cross-origin reads is inlined through the server; one nobody can read is blanked and counted', async () => {
    // The browser's own read fails the way a host without CORS headers makes it fail.
    vi.stubGlobal('fetch', async () => Promise.reject(new TypeError('Failed to fetch')));
    const asked: string[] = [];
    const host = {
      ...makeHost(),
      fetchImage: async (url: string) => {
        asked.push(url);
        if (url.includes('gone.example')) throw new Error('422');
        return new Blob([PNG_BYTES], { type: 'image/png' });
      },
    };
    const inline = createRemoteImageInliner(() => host, 'https://freero.test');
    const el = node('https://photos.example/cat.png', 'https://gone.example/dog.png', 'https://freero.test/uploads/own.png');

    expect(await inline(el)).toEqual({ found: 2, missing: 1 });
    const [cat, dog, own] = Array.from(el.querySelectorAll('img')).map((i) => i.src);
    expect(cat).toMatch(/^data:image\/png;base64,/);
    // Blanked, so html-to-image doesn't try (and fail) to fetch it again.
    expect(dog).toMatch(/^data:image\/gif;base64,/);
    // Our own uploads are same-origin: html-to-image reads them itself.
    expect(own).toBe('https://freero.test/uploads/own.png');
    expect(asked).not.toContain('https://freero.test/uploads/own.png');
  });
});

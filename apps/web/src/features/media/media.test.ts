import { describe, expect, it } from 'vitest';
import { storeFile, type Uploads } from './lib/store';
import type { Probed } from './lib/probe';

const plays: Probed = { kind: 'video', duration: 12, w: 640, h: 360, poster: null };
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

/** Records what was stored where; `media` decides how the server answers a video / audio upload. */
function server(media: () => Promise<{ url: string }>) {
  const attached: Blob[] = [];
  const host: Uploads = {
    uploadFile: media,
    uploadImage: async () => ({ url: '/uploads/poster.jpg' }),
    uploadAttachment: async (b) => {
      attached.push(b);
      return { url: '/uploads/abcdef.bin' };
    },
  };
  return { host, attached };
}

describe('adding a dropped file', () => {
  it('keeps a video the server cannot verify as playable as a file card instead of losing it', async () => {
    const { host, attached } = server(() => Promise.reject(httpError(415, 'This isn’t a video or audio format Freero can play')));
    const file = new File([new Uint8Array(32)], 'clip.mkv', { type: 'video/x-matroska' });
    const stored = await storeFile(host, file, async () => plays);
    expect(stored).toMatchObject({ kind: 'file', src: '/uploads/abcdef.bin' });
    expect(attached).toHaveLength(1);
  });

  it('reports a video over the size cap instead of silently storing it as a file (which would hide the cap)', async () => {
    const { host, attached } = server(() => Promise.reject(httpError(413, 'File is too large (max 100MB for video and audio)')));
    const file = new File([new Uint8Array(32)], 'talk.mp4', { type: 'video/mp4' });
    const stored = await storeFile(host, file, async () => plays);
    expect(stored).toMatchObject({ kind: 'error', message: 'File is too large (max 100MB for video and audio)' });
    expect(attached).toHaveLength(0);
  });

  it('uploads a media file the system labelled generically as video, so the server sniffs it instead of refusing an unknown type', async () => {
    let declared = '';
    const { host } = server(async () => ({ url: '/uploads/abcdef.mov' }));
    const upload = host.uploadFile;
    host.uploadFile = (b) => {
      declared = b.type;
      return upload(b);
    };
    const stored = await storeFile(host, new File([new Uint8Array(32)], 'Holiday.MOV', { type: '' }), async () => plays);
    expect(stored.kind).toBe('media');
    expect(declared).toBe('video/quicktime');
  });
});

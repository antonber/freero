// Uploading one dropped file: video and audio this browser plays go up as media (with a poster
// still for videos); everything else — and media the server can't verify as a container it
// serves for playback — goes up as an attachment, shown as a file card. Nothing is lost silently.
import type { Host } from '@engine';
import { mediaTypeOf, probeMedia, type Probed } from './probe';

export type Uploads = Pick<Host, 'uploadFile' | 'uploadImage' | 'uploadAttachment'>;

export type Stored =
  | { kind: 'media'; file: File; src: string; poster: string | null; probed: Probed }
  | { kind: 'file'; file: File; src: string }
  | { kind: 'error'; file: File; message: string };

const statusOf = (e: unknown) => (e as { status?: unknown } | null)?.status;

const messageOf = (e: unknown, fallback: string) =>
  e instanceof Error && e.message && e.message !== 'Upload failed' && e.message !== 'Failed to fetch' ? e.message : fallback;

export async function storeFile(host: Uploads, file: File, probe: (f: Blob) => Promise<Probed | null> = probeMedia): Promise<Stored> {
  const failed = (e: unknown): Stored => ({ kind: 'error', file, message: messageOf(e, `Couldn't upload “${file.name}”. Try again later.`) });
  const type = mediaTypeOf(file);
  const probed = type ? await probe(file) : null;
  if (type && probed) {
    try {
      // Declared as what it is (some systems report '' for media files): the server sniffs the bytes.
      const { url } = await host.uploadFile(file.type === type ? file : new Blob([file], { type }));
      let poster: string | null = null;
      if (probed.poster) {
        try {
          poster = (await host.uploadImage(probed.poster)).url || null;
        } catch {
          // no still: the item shows a plain dark frame until played
        }
      }
      return { kind: 'media', file, src: url, poster, probed };
    } catch (e) {
      // 415: plays here, but isn't a container the server serves for playback → a file card.
      // Anything else (too large, quota, offline) would fail the same way as an attachment.
      if (statusOf(e) !== 415) return failed(e);
    }
  }
  if (!host.uploadAttachment) return { kind: 'error', file, message: 'Files can’t be added to this board.' };
  try {
    return { kind: 'file', file, src: (await host.uploadAttachment(file)).url };
  } catch (e) {
    return failed(e);
  }
}

// Reading a dropped video or audio file locally, before it is uploaded: does this browser play it,
// is it a video or audio only, how long, how large — and a still frame for its poster.
import { extensionOf } from './kinds';

/** Types browsers commonly report as '' or something generic, by extension. */
const MEDIA_TYPE_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
};

/** The video/audio type to upload this file as, or null when it isn't one (a file card then). */
export function mediaTypeOf(file: File): string | null {
  if (file.type.startsWith('video/') || file.type.startsWith('audio/')) return file.type;
  return MEDIA_TYPE_BY_EXT[extensionOf(file.name)] ?? null;
}

export interface Probed {
  kind: 'video' | 'audio';
  /** Seconds; 0 when unknown (live streams, some WebM files). */
  duration: number;
  w: number;
  h: number;
  /** A JPEG still of the video (null for audio, or when the browser couldn't draw one). */
  poster: Blob | null;
}

/** Longest side of the poster image, px. */
const POSTER_MAX = 960;

/** Plays `file` silently far enough to know what it is; null when this browser can't play it. */
export function probeMedia(file: Blob, timeoutMs = 15_000): Promise<Probed | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    let done = false;
    const finish = (result: Probed | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    let meta: Omit<Probed, 'poster'> | null = null;
    const still = () => {
      if (!meta) return;
      finish({ ...meta, poster: null });
    };
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onerror = () => finish(null);
    v.onloadedmetadata = () => {
      const duration = Number.isFinite(v.duration) ? v.duration : 0;
      if (!v.videoWidth || !v.videoHeight) {
        finish({ kind: 'audio', duration, w: 0, h: 0, poster: null });
        return;
      }
      meta = { kind: 'video', duration, w: v.videoWidth, h: v.videoHeight };
      // A frame a little in (the very first one is often black), then draw it.
      const at = duration > 0 ? Math.min(1, duration / 10) : 0;
      if (at > 0) v.currentTime = at;
      else v.onloadeddata = () => void capture();
    };
    const capture = async () => {
      if (!meta || done) return;
      try {
        const scale = Math.min(1, POSTER_MAX / Math.max(meta.w, meta.h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(meta.w * scale));
        canvas.height = Math.max(1, Math.round(meta.h * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return still();
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
        finish({ ...meta, poster: blob });
      } catch {
        still();
      }
    };
    v.onseeked = () => void capture();
    v.src = url;
  });
}

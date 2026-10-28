// Avatar images: decoded, center-cropped and resized server-side (so a 12-megapixel photo never
// reaches other people's browsers), then stored through the uploads module.
import { Jimp } from 'jimp';
import { badRequest, HttpError } from '../../platform/http';

export const AVATAR_SIZE = 256;
export const MAX_AVATAR_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Refuse to decode anything larger: a tiny file can declare a huge canvas (decompression bomb). */
const MAX_PIXELS = 40_000_000;

type Kind = 'png' | 'jpeg' | 'gif';

function sniff(data: Uint8Array): Kind | null {
  const at = (bytes: number[], offset = 0) => bytes.every((b, i) => data[offset + i] === b);
  if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (at([0xff, 0xd8, 0xff])) return 'jpeg';
  if (at([0x47, 0x49, 0x46, 0x38])) return 'gif';
  return null;
}

/** Width x height from the file header, without decoding pixels; null if it can't be read. */
export function declaredSize(data: Uint8Array, kind: Kind): { w: number; h: number } | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  try {
    if (kind === 'png') return { w: view.getUint32(16), h: view.getUint32(20) };
    if (kind === 'gif') return { w: view.getUint16(6, true), h: view.getUint16(8, true) };
    // JPEG: walk the segments to the first start-of-frame marker.
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) return null;
      const marker = data[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      const len = view.getUint16(i + 2);
      const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (sof) return { h: view.getUint16(i + 5), w: view.getUint16(i + 7) };
      i += 2 + len;
    }
  } catch {
    /* truncated */
  }
  return null;
}

/**
 * A square AVATAR_SIZE image (JPEG for photos, PNG otherwise, so transparency survives), or a
 * 400/415 for anything that isn't a readable PNG, JPEG or GIF of a sane size.
 */
export async function makeAvatar(data: Uint8Array): Promise<{ bytes: Buffer; type: 'image/png' | 'image/jpeg' }> {
  if (data.byteLength === 0) throw badRequest('Choose an image to upload');
  if (data.byteLength > MAX_AVATAR_UPLOAD_BYTES) throw new HttpError(413, 'That image is too large (max 10MB)');
  const kind = sniff(data);
  if (!kind) throw new HttpError(415, 'Use a PNG, JPEG or GIF image for your avatar');
  const size = declaredSize(data, kind);
  if (!size || size.w === 0 || size.h === 0) throw badRequest('That image could not be read');
  if (size.w * size.h > MAX_PIXELS) throw badRequest('That image is too large (max 40 megapixels)');
  let image;
  try {
    image = await Jimp.fromBuffer(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  } catch {
    throw badRequest('That image could not be read');
  }
  image.cover({ w: AVATAR_SIZE, h: AVATAR_SIZE });
  if (kind === 'jpeg') return { bytes: await image.getBuffer('image/jpeg', { quality: 86 }), type: 'image/jpeg' };
  return { bytes: await image.getBuffer('image/png'), type: 'image/png' };
}

import { crc32 } from 'node:zlib';
import { Jimp } from 'jimp';
import { expect, it } from 'vitest';
import { AVATAR_SIZE, makeAvatar } from './avatar';

it('a large, non-square photo is stored as a small square avatar, not as uploaded', async () => {
  const photo = await new Jimp({ width: 1200, height: 600, color: 0x3366ccff }).getBuffer('image/jpeg');
  const { bytes, type } = await makeAvatar(photo);
  const out = await Jimp.fromBuffer(bytes);
  expect([out.width, out.height]).toEqual([AVATAR_SIZE, AVATAR_SIZE]);
  expect(type).toBe('image/jpeg');
  expect(bytes.byteLength).toBeLessThan(photo.byteLength);
});

it('refuses an image declaring a gigantic canvas before decoding it (decompression bomb)', async () => {
  const png = await new Jimp({ width: 1, height: 1, color: 0xffffffff }).getBuffer('image/png');
  const bomb = Buffer.from(png);
  bomb.writeUInt32BE(50_000, 16); // IHDR width
  bomb.writeUInt32BE(50_000, 20); // IHDR height
  bomb.writeUInt32BE(crc32(bomb.subarray(12, 29)), 29); // a valid header: decoders would believe it
  await expect(makeAvatar(bomb)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/megapixels/) });
});

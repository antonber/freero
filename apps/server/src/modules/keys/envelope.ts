// The envelope's data layer: AES-256-GCM with a 96-bit random nonce, and additional data that
// names where a blob belongs (workspace, board, table, layer) so a blob copied anywhere else never
// opens. Layout: nonce (12) | tag (16) | ciphertext. Which data key sealed it is recorded next to
// the blob (realtime's `sealed_with` column), not inside it.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const NONCE = 12;
const TAG = 16;

export function sealBlob(dek: Buffer, aad: string, plain: Uint8Array): Buffer {
  const nonce = randomBytes(NONCE);
  const c = createCipheriv('aes-256-gcm', dek, nonce);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([nonce, c.getAuthTag(), body]);
}

/** Throws when the key, the additional data or a single byte doesn't match. */
export function openBlob(dek: Buffer, aad: string, data: Uint8Array): Buffer {
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (b.length < NONCE + TAG) throw new Error('sealed blob too short');
  const d = createDecipheriv('aes-256-gcm', dek, b.subarray(0, NONCE));
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(b.subarray(NONCE, NONCE + TAG));
  return Buffer.concat([d.update(b.subarray(NONCE + TAG)), d.final()]);
}

export const newDataKey = (): Buffer => randomBytes(32);

import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('rejects a wrong password and never stores the plaintext', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).not.toContain('correct horse');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterz', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('does not produce identical hashes for identical passwords (missing salt)', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('does not throw or accept on a corrupt stored hash', async () => {
    for (const stored of ['', 'plain-text-password', 'scrypt$a$b$c$d$e', 'bcrypt$1$1$1$AAAA$AAAA']) {
      expect(await verifyPassword('x', stored)).toBe(false);
    }
  });

  it('does not lock out users whose keyboard sends a differently-composed é', async () => {
    const hash = await hashPassword('café-1234');
    expect(await verifyPassword('café-1234', hash)).toBe(true);
  });
});

// client/src/utils/crypto.test.ts
import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  bytesToBase64,
  decryptApiKey,
  deriveKey,
  encryptApiKey,
  newIv,
  newSalt,
} from './crypto';

describe('crypto utils', (): void => {
  it('creates a 16-byte salt and a 12-byte iv', (): void => {
    const salt: Uint8Array = newSalt();
    const iv: Uint8Array = newIv();
    expect(salt).toBeInstanceOf(Uint8Array);
    expect(salt.length).toBe(16);
    expect(iv).toBeInstanceOf(Uint8Array);
    expect(iv.length).toBe(12);
  });

  it('round-trips bytes through base64', (): void => {
    const original: Uint8Array = new Uint8Array([0, 1, 2, 250, 255]);
    const encoded: string = bytesToBase64(original);
    const decoded: Uint8Array = base64ToBytes(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('derives a PBKDF2 key and round-trips AES-GCM', async (): Promise<void> => {
    const salt: Uint8Array = newSalt();
    const key: CryptoKey = await deriveKey('correct-horse-battery', salt);
    const encrypted: { ciphertext: string; iv: string } = await encryptApiKey(
      key,
      'sk-test-secret',
    );
    // Same passphrase + salt derives an interoperable key.
    const sameKey: CryptoKey = await deriveKey(
      'correct-horse-battery',
      salt,
    );
    await expect(
      decryptApiKey(sameKey, encrypted.ciphertext, encrypted.iv),
    ).resolves.toBe('sk-test-secret');
  });

  it('fails to decrypt with a wrong IV', async (): Promise<void> => {
    const salt: Uint8Array = newSalt();
    const key: CryptoKey = await deriveKey('another-passphrase', salt);
    const encrypted: { ciphertext: string; iv: string } = await encryptApiKey(
      key,
      'sk-test-secret',
    );
    let wrongIv: string = bytesToBase64(newIv());
    if (wrongIv === encrypted.iv) {
      wrongIv = bytesToBase64(newIv());
    }
    expect(wrongIv).not.toBe(encrypted.iv);
    await expect(
      decryptApiKey(key, encrypted.ciphertext, wrongIv),
    ).rejects.toThrow();
  });
});

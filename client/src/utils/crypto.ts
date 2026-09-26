// client/src/utils/crypto.ts

const PBKDF2_ITERATIONS = 310000;
const SALT_LENGTH_BYTES = 16;
const IV_LENGTH_BYTES = 12;

export function newSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
}

export function newIv(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function deriveKey(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function encryptApiKey(
  key: CryptoKey,
  raw: string
): Promise<{ ciphertext: string; iv: string }> {
  const enc = new TextEncoder();
  const iv = newIv();
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    enc.encode(raw)
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptApiKey(
  key: CryptoKey,
  ciphertext: string,
  iv: string
): Promise<string> {
  const ciphertextBytes = base64ToBytes(ciphertext);
  const ivBytes = base64ToBytes(iv);
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes as BufferSource },
    key,
    ciphertextBytes as BufferSource
  );
  return new TextDecoder().decode(plaintextBuffer);
}

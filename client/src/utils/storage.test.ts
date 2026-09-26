// client/src/utils/storage.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UserProfile } from '../types/index';
import { setDeviceKeyProviderForTests } from './deviceKey';
import {
  clearApiKey,
  getApiKey,
  getFillPrefs,
  getProfile,
  getServerUrl,
  hasApiKey,
  hasLegacyPassphraseKey,
  saveApiKey,
  saveFillPrefs,
  saveServerUrl,
  saveProfile,
} from './storage';

interface Area {
  get: (keys: string | string[], cb: (items: Record<string, unknown>) => void) => void;
  set: (items: Record<string, unknown>, cb: () => void) => void;
  remove: (keys: string | string[], cb: () => void) => void;
}

function makeArea(store: Map<string, unknown>): Area {
  return {
    get: (keys, cb): void => {
      const out: Record<string, unknown> = {};
      for (const k of typeof keys === 'string' ? [keys] : keys) {
        if (store.has(k)) out[k] = store.get(k);
      }
      cb(out);
    },
    set: (items, cb): void => {
      for (const [k, v] of Object.entries(items)) store.set(k, v);
      cb();
    },
    remove: (keys, cb): void => {
      for (const k of typeof keys === 'string' ? [keys] : keys) store.delete(k);
      cb();
    },
  };
}

let local: Map<string, unknown>;
let deviceKey: CryptoKey;

beforeEach(async (): Promise<void> => {
  local = new Map<string, unknown>();
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { local: makeArea(local) }, runtime: {} };
  deviceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  setDeviceKeyProviderForTests(async () => deviceKey);
});

afterEach((): void => {
  setDeviceKeyProviderForTests(null);
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

const PROFILE: UserProfile = {
  fullName: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: null,
  headline: 'Engineer',
  summary: null,
  updatedAt: 1,
};

describe('profile storage', (): void => {
  it('round-trips a profile and returns null when missing', async (): Promise<void> => {
    await expect(getProfile()).resolves.toBeNull();
    await saveProfile(PROFILE);
    await expect(getProfile()).resolves.toEqual(PROFILE);
  });

  it('rejects when chrome.storage is unavailable', async (): Promise<void> => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    await expect(getProfile()).rejects.toThrow('chrome.storage unavailable');
  });
});

describe('API key storage (no passphrase)', (): void => {
  it('returns null when no key is saved', async (): Promise<void> => {
    await expect(getApiKey()).resolves.toBeNull();
    await expect(hasApiKey()).resolves.toBe(false);
  });

  it('saves the key encrypted, never as plain text, and reads it back', async (): Promise<void> => {
    await saveApiKey('  nvapi-SECRET-1234567890  ');
    const dump = JSON.stringify(Object.fromEntries(local));
    expect(dump).not.toContain('SECRET');
    expect(local.has('rbg_api_key')).toBe(false);
    await expect(getApiKey()).resolves.toBe('nvapi-SECRET-1234567890');
    await expect(hasApiKey()).resolves.toBe(true);
  });

  it('cannot be read with a different device key', async (): Promise<void> => {
    await saveApiKey('nvapi-SECRET-1234567890');
    const other = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    setDeviceKeyProviderForTests(async () => other);
    await expect(getApiKey()).rejects.toThrow();
  });

  it('migrates a plain-text key left by an older build', async (): Promise<void> => {
    local.set('rbg_api_key', 'nvapi-PLAIN-abcdefgh');
    await expect(getApiKey()).resolves.toBe('nvapi-PLAIN-abcdefgh');
    expect(local.has('rbg_api_key')).toBe(false);
    expect(JSON.stringify(Object.fromEntries(local))).not.toContain('PLAIN');
    await expect(getApiKey()).resolves.toBe('nvapi-PLAIN-abcdefgh');
  });

  it('detects and clears an old passphrase-encrypted key', async (): Promise<void> => {
    local.set('rbg_api_ciphertext', 'x');
    local.set('rbg_api_salt', 'y');
    local.set('rbg_api_iv', 'z');
    await expect(hasLegacyPassphraseKey()).resolves.toBe(true);
    await saveApiKey('nvapi-NEW-123456789');
    await expect(hasLegacyPassphraseKey()).resolves.toBe(false);
    expect(local.has('rbg_api_salt')).toBe(false);
  });

  it('removes the key', async (): Promise<void> => {
    await saveApiKey('nvapi-SECRET-1234567890');
    await clearApiKey();
    await expect(getApiKey()).resolves.toBeNull();
    expect(local.size).toBe(0);
  });

  it('refuses an empty key', async (): Promise<void> => {
    await expect(saveApiKey('   ')).rejects.toThrow('API key is empty');
  });
});

describe('fill prefs', (): void => {
  it('defaults and round-trips', async (): Promise<void> => {
    await expect(getFillPrefs()).resolves.toEqual({ animate: true, agents: 3, speed: 'normal', aiProfileConsent: true });
    await saveFillPrefs({ animate: false, agents: 5, speed: 'fast', aiProfileConsent: false });
    await expect(getFillPrefs()).resolves.toEqual({ animate: false, agents: 5, speed: 'fast', aiProfileConsent: false });
  });
});

describe('server url', (): void => {
  it('round-trips, trims, and removes on empty', async (): Promise<void> => {
    await expect(getServerUrl()).resolves.toBeNull();
    await saveServerUrl('  https://my-app.fly.dev  ');
    await expect(getServerUrl()).resolves.toBe('https://my-app.fly.dev');
    await saveServerUrl('');
    await expect(getServerUrl()).resolves.toBeNull();
  });
});

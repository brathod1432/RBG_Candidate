// client/src/utils/storage.ts
// Chrome API types come from src/globals.d.ts (declare const chrome — true global).
import type { UserProfile } from "../types/index";
import { normalizeFillPrefs, type FillPrefs } from "../agents/palette";
import { decryptApiKey, encryptApiKey } from "./crypto";
import { getDeviceKey } from "./deviceKey";

const PROFILE_KEY = "rbg_profile";
/** Encrypted NVIDIA key: { ciphertext, iv } (AES-GCM with the device key). */
const API_KEY_ENC = "rbg_api_key_enc";
/** Legacy entries, removed on first use. */
const LEGACY_PLAINTEXT = "rbg_api_key";
const LEGACY_PASSPHRASE = ["rbg_api_ciphertext", "rbg_api_salt", "rbg_api_iv"];
const FILL_PREFS_KEY = "rbg_fill_prefs";
/** Server base URL override (empty = the built-in http://127.0.0.1:8000). */
const SERVER_URL_KEY = "rbg_server_url";

function assertChromeStorage(): void {
  if (typeof chrome === "undefined" || !chrome.storage) {
    throw new Error("chrome.storage unavailable");
  }
}

function throwIfLastError(): void {
  const err = chrome.runtime?.lastError;
  if (err) {
    throw new Error(err.message ?? "chrome.storage operation failed");
  }
}

function localGet(
  keys: string | string[]
): Promise<Record<string, unknown>> {
  assertChromeStorage();
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      try {
        throwIfLastError();
        resolve(items as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function localSet(items: Record<string, unknown>): Promise<void> {
  assertChromeStorage();
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      try {
        throwIfLastError();
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}



export async function getProfile(): Promise<UserProfile | null> {
  const items = await localGet(PROFILE_KEY);
  const profile = items[PROFILE_KEY] as UserProfile | undefined;
  return profile ?? null;
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await localSet({ [PROFILE_KEY]: profile });
}

function localRemove(keys: string[]): Promise<void> {
  assertChromeStorage();
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      try {
        throwIfLastError();
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

interface EncryptedKey {
  ciphertext: string;
  iv: string;
}

function isEncryptedKey(value: unknown): value is EncryptedKey {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["ciphertext"] === "string" &&
    typeof (value as Record<string, unknown>)["iv"] === "string"
  );
}

/** Save the NVIDIA key encrypted with the device key (no passphrase). */
export async function saveApiKey(raw: string): Promise<void> {
  const key = raw.trim();
  if (key === "") {
    throw new Error("API key is empty");
  }
  const enc = await encryptApiKey(await getDeviceKey(), key);
  await localSet({ [API_KEY_ENC]: enc });
  await localRemove([LEGACY_PLAINTEXT, ...LEGACY_PASSPHRASE]);
}

/**
 * The saved NVIDIA key, or null. A plain-text key left by an older build is
 * encrypted and the plain copy deleted the first time it is read.
 */
export async function getApiKey(): Promise<string | null> {
  const items = await localGet([API_KEY_ENC, LEGACY_PLAINTEXT]);
  const enc = items[API_KEY_ENC];
  if (isEncryptedKey(enc)) {
    return await decryptApiKey(await getDeviceKey(), enc.ciphertext, enc.iv);
  }
  const legacy = items[LEGACY_PLAINTEXT];
  if (typeof legacy === "string" && legacy.trim() !== "") {
    await saveApiKey(legacy);
    return legacy.trim();
  }
  return null;
}

/** Whether a key is saved (never decrypts). */
export async function hasApiKey(): Promise<boolean> {
  const items = await localGet([API_KEY_ENC, LEGACY_PLAINTEXT]);
  return isEncryptedKey(items[API_KEY_ENC]) || (typeof items[LEGACY_PLAINTEXT] === "string" && items[LEGACY_PLAINTEXT] !== "");
}

/** Forget the saved key (and any legacy copies). */
export async function clearApiKey(): Promise<void> {
  await localRemove([API_KEY_ENC, LEGACY_PLAINTEXT, ...LEGACY_PASSPHRASE]);
}

/** A passphrase-encrypted key from the old build that can no longer be opened. */
export async function hasLegacyPassphraseKey(): Promise<boolean> {
  const items = await localGet(LEGACY_PASSPHRASE);
  return typeof items["rbg_api_ciphertext"] === "string";
}

/** Typing-agent preferences (count, speed, on/off). Not sensitive. */
export async function getFillPrefs(): Promise<FillPrefs> {
  const items = await localGet(FILL_PREFS_KEY);
  return normalizeFillPrefs(items[FILL_PREFS_KEY]);
}

export async function saveFillPrefs(prefs: FillPrefs): Promise<void> {
  await localSet({ [FILL_PREFS_KEY]: normalizeFillPrefs(prefs) });
}

/** The saved server base URL, or null (the built-in localhost default applies). */
export async function getServerUrl(): Promise<string | null> {
  const items = await localGet(SERVER_URL_KEY);
  const url = items[SERVER_URL_KEY];
  return typeof url === "string" && url.trim() !== "" ? url.trim() : null;
}

/** Save the server base URL (empty removes it). */
export async function saveServerUrl(url: string): Promise<void> {
  const v = url.trim();
  if (v === "") {
    await localRemove([SERVER_URL_KEY]);
    return;
  }
  await localSet({ [SERVER_URL_KEY]: v });
}

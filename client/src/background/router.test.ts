// client/src/background/router.test.ts
import { describe, expect, it } from 'vitest';
import type { FieldMap, UserProfile } from '../types/index';
import {
  isTrustedSender,
  offlineExactMatch,
  postAnalyzeToServer,
  type ChromeMessageSender,
} from './router';

describe('background router', (): void => {
  it('trusts popup senders without a tab', (): void => {
    const popup: ChromeMessageSender = {};
    expect(isTrustedSender(popup)).toBe(true);
  });

  it('rejects content-script senders that carry a tab', (): void => {
    const withTab: ChromeMessageSender = { tab: { id: 7 } };
    const tabWithoutId: ChromeMessageSender = { tab: {} };
    expect(isTrustedSender(withTab)).toBe(false);
    expect(isTrustedSender(tabWithoutId)).toBe(false);
  });

  it('trusts the popup opened as a tab via its own extension url', (): void => {
    (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { id: 'abcdefghijklmnopabcdefghijklmnop' } };
    try {
      const ownPage: ChromeMessageSender = {
        tab: { id: 3 },
        id: 'abcdefghijklmnopabcdefghijklmnop',
        url: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
      };
      const contentScript: ChromeMessageSender = {
        tab: { id: 3 },
        id: 'abcdefghijklmnopabcdefghijklmnop',
        url: 'https://jobs.example.com/apply',
      };
      const otherExtension: ChromeMessageSender = {
        id: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
        url: 'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/x.html',
      };
      expect(isTrustedSender(ownPage)).toBe(true);
      expect(isTrustedSender(contentScript)).toBe(false);
      expect(isTrustedSender(otherExtension)).toBe(false);
    } finally {
      delete (globalThis as unknown as { chrome?: unknown }).chrome;
    }
  });

  it('offlineExactMatch keeps only non-empty profile values', (): void => {
    const profile: UserProfile = {
      fullName: 'Ada Lovelace',
      email: '',
      phone: null,
      headline: 'Engineer',
      summary: null,
      updatedAt: 1,
    };
    const fields: FieldMap = {
      fullName: '#fullName',
      email: '#email',
      phone: '#phone',
      headline: '#headline',
      summary: '#summary',
      unknownField: '#unknown',
    };
    expect(offlineExactMatch(profile, fields)).toEqual({
      fullName: 'Ada Lovelace',
      headline: 'Engineer',
    });
  });

  it('offlineExactMatch returns empty for a null profile', (): void => {
    const fields: FieldMap = { fullName: '#fullName', email: '#email' };
    expect(offlineExactMatch(null, fields)).toEqual({});
  });

  it('rejects non-local http base urls', async (): Promise<void> => {
    await expect(
      postAnalyzeToServer('<html></html>', null, 'http://example.com'),
    ).rejects.toThrow('server base URL must use https');
  });

  it('rejects an empty base url', async (): Promise<void> => {
    await expect(postAnalyzeToServer('<html></html>', null, '')).rejects.toThrow(
      'server base URL is empty',
    );
  });
});

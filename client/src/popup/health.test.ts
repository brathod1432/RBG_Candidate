// client/src/popup/health.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checksFrom, deriveStatus, nextDelay, POLL_BUSY_MS, POLL_MAX_MS, POLL_READY_MS } from './health';
import { fetchHealth } from '../background/router';

const ok = { status: 'ok' as const, nvidiaApiKeyConfigured: true, workersActive: 15, workersTotal: 15, models: ['m'] };

describe('prepare health', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('is ready only with server, a key and all workers', (): void => {
    expect(deriveStatus(checksFrom(ok, false))).toBe('ready');
    expect(deriveStatus(checksFrom({ ...ok, workersActive: 9 }, false))).toBe('degraded');
    expect(deriveStatus(checksFrom({ ...ok, nvidiaApiKeyConfigured: false }, false))).toBe('degraded');
    expect(deriveStatus(checksFrom({ ...ok, status: 'down', workersTotal: 0, workersActive: 0 }, true))).toBe('down');
  });

  it("counts the user's own encrypted key as configured", (): void => {
    const c = checksFrom({ ...ok, nvidiaApiKeyConfigured: false }, true);
    expect(c.apiKey).toBe(true);
    expect(c.keySource).toBe('yours');
    expect(checksFrom(ok, true).keySource).toBe('both');
    expect(deriveStatus(c)).toBe('ready');
  });

  it('polls fast until ready, relaxes when ready, backs off when down', (): void => {
    expect(nextDelay('degraded', 8000)).toBe(POLL_BUSY_MS);
    expect(nextDelay('ready', POLL_BUSY_MS)).toBe(POLL_READY_MS);
    expect(nextDelay('down', POLL_BUSY_MS)).toBe(POLL_BUSY_MS * 2);
    expect(nextDelay('down', POLL_MAX_MS)).toBe(POLL_MAX_MS);
  });

  it('fetchHealth parses the server reply and never throws', async (): Promise<void> => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(ok), { status: 200 })));
    await expect(fetchHealth()).resolves.toEqual(ok);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(fetchHealth()).resolves.toMatchObject({ status: 'down', workersTotal: 0 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await expect(fetchHealth()).resolves.toMatchObject({ status: 'down' });
  });
});

// client/src/agents/palette.test.ts
import { describe, expect, it } from 'vitest';
import {
  AGENT_PALETTE,
  clampAgents,
  MAX_AGENTS,
  MAX_FIELD_TYPING_MS,
  normalizeFillPrefs,
  personasFor,
  travelMs,
  typingPlan,
} from './palette';

describe('typing agents palette', (): void => {
  it('has unique names and colours', (): void => {
    expect(new Set(AGENT_PALETTE.map((a) => a.name)).size).toBe(AGENT_PALETTE.length);
    expect(new Set(AGENT_PALETTE.map((a) => a.color)).size).toBe(AGENT_PALETTE.length);
    expect(personasFor(3).map((a) => a.name)).toEqual(['Nova', 'Echo', 'Blaze']);
  });

  it('clamps agent count and normalises prefs', (): void => {
    expect(clampAgents(0)).toBe(1);
    expect(clampAgents(99)).toBe(MAX_AGENTS);
    expect(clampAgents('x')).toBe(3);
    expect(normalizeFillPrefs(null)).toEqual({ animate: true, agents: 3, speed: 'normal', aiProfileConsent: true });
    expect(normalizeFillPrefs({ animate: false, agents: 5, speed: 'fast' })).toEqual({
      animate: false, agents: 5, speed: 'fast', aiProfileConsent: true,
    });
    expect(normalizeFillPrefs({ speed: 'warp' }).speed).toBe('normal');
  });

  it('aiProfileConsent defaults on and survives a save', (): void => {
    expect(normalizeFillPrefs({}).aiProfileConsent).toBe(true);
    expect(normalizeFillPrefs({ aiProfileConsent: false }).aiProfileConsent).toBe(false);
    expect(normalizeFillPrefs({ aiProfileConsent: true }).aiProfileConsent).toBe(true);
    // old prefs saved before the consent switch existed: default on
    expect(normalizeFillPrefs({ animate: true, agents: 2, speed: 'slow' }).aiProfileConsent).toBe(true);
  });

  it('types short values one letter per tick', (): void => {
    expect(typingPlan(12, 'normal')).toMatchObject({ chunk: 1, ticks: 12 });
    expect(typingPlan(0, 'fast').ticks).toBe(0);
  });

  it('caps long values to the per-field time budget', (): void => {
    for (const speed of ['slow', 'normal', 'fast'] as const) {
      const plan = typingPlan(4000, speed);
      expect(plan.chunk).toBeGreaterThan(1);
      expect(plan.ticks * plan.delayMs).toBeLessThanOrEqual(MAX_FIELD_TYPING_MS[speed] + plan.delayMs);
    }
  });

  it('travel time grows with distance but is capped', (): void => {
    expect(travelMs(0, 'normal')).toBeLessThan(travelMs(600, 'normal'));
    expect(travelMs(100000, 'normal')).toBe(Math.round(320 * 2.2));
  });
});

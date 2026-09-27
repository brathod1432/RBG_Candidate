// client/src/profile/completeness.test.ts
// @vitest-environment jsdom
// Profile completeness: percent, missing critical fields, empty-profile edge.

import { describe, expect, it } from 'vitest';
import { profileCompleteness } from './completeness';

describe('profile completeness', (): void => {
  it('an empty profile scores 0 with every critical field missing', (): void => {
    const c = profileCompleteness({});
    expect(c.percent).toBe(0);
    expect(c.filled).toBe(0);
    expect(c.total).toBe(11);
    expect(c.missingCritical).toContain('Work authorization');
    expect(c.missingCritical).toContain('Relocation');
    expect(c.missingCritical).toContain('Salary');
  });

  it('a fully filled profile scores 100 with nothing missing', (): void => {
    const filled = Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => [`k${i}`, 'x']),
    );
    // use the real keys
    const personal: Record<string, string> = {
      full_name: 'Brijesh Rathod',
      email: 'b@example.com',
      phone: '+48',
      location: 'Warsaw, Poland',
      work_authorization: 'Yes',
      visa_sponsorship: 'No',
      willing_to_relocate: 'Yes',
      work_mode: 'hybrid',
      notice_period: 'Immediate',
      available_from: '2026-10-01',
      desired_salary: 'TBD',
    };
    void filled;
    const c = profileCompleteness(personal);
    expect(c.percent).toBe(100);
    expect(c.missingCritical).toEqual([]);
  });

  it('a partial profile computes the rounded percentage and the missing list', (): void => {
    const c = profileCompleteness({
      full_name: 'Brijesh Rathod',
      email: 'b@example.com',
      phone: '+48',
      location: 'Warsaw, Poland',
    });
    // 4 of 11 filled -> 36%
    expect(c.percent).toBe(36);
    expect(c.filled).toBe(4);
    expect(c.missingCritical).toEqual([
      'Work authorization',
      'Visa sponsorship',
      'Relocation',
      'Work mode',
      'Notice period',
      'Availability',
      'Salary',
    ]);
  });

  it('whitespace-only values count as missing', (): void => {
    const c = profileCompleteness({ full_name: '   ' });
    expect(c.fields[0].filled).toBe(false);
  });
});

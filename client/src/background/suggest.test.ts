// client/src/background/suggest.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldDescriptor, UserProfile } from '../types/index';
import {
  answersToSuggestions,
  buildFillPayload,
  isAiSuggestRequest,
  localSuggestions,
  suggestWithFallback,
} from './router';

const PROFILE: UserProfile = {
  fullName: 'Ada King Lovelace',
  email: 'ada@example.com',
  phone: '+44 1',
  headline: 'Engineer',
  summary: 'Built engines',
  resume: 'Worked at Analytical Co 1840-1850',
  updatedAt: 1,
};

function d(id: string, label: string, extra: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return {
    id,
    selector: `#${id}`,
    label,
    type: 'text',
    placeholder: '',
    options: [],
    required: false,
    ...extra,
  };
}

const DESCRIPTORS: FieldDescriptor[] = [
  d('first', 'First name', { profileKey: 'fullName' }),
  d('last', 'Last name', { profileKey: 'fullName' }),
  d('mail', 'Email', { type: 'email', profileKey: 'email' }),
  d('why', 'Why us?', { type: 'textarea', maxLength: 500 }),
  d('yrs', 'Years', { type: 'select', options: ['0-1', '2-4'] }),
];

function installChrome(local: Record<string, unknown>): void {
  const area = {
    get: (keys: string | string[], cb: (items: Record<string, unknown>) => void): void => {
      const names = typeof keys === 'string' ? [keys] : keys;
      const out: Record<string, unknown> = {};
      for (const n of names) {
        if (n in local) out[n] = local[n];
      }
      cb(out);
    },
    set: (_items: Record<string, unknown>, cb: () => void): void => cb(),
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: area, session: area },
    runtime: {},
  };
}

describe('AI suggestion plumbing', (): void => {
  beforeEach((): void => {
    installChrome({ rbg_profile: PROFILE });
  });
  afterEach((): void => {
    vi.unstubAllGlobals();
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('localSuggestions splits names and leaves unknown fields empty', (): void => {
    const s = localSuggestions(PROFILE, DESCRIPTORS);
    expect(s['first']?.value).toBe('Ada');
    expect(s['last']?.value).toBe('Lovelace');
    expect(s['mail']).toEqual({ value: 'ada@example.com', source: 'profile', confidence: 1 });
    expect(s['why']).toEqual({ value: '', source: 'none', confidence: 0 });
    expect(s['yrs']?.value).toBe('');
  });

  it('localSuggestions notice period select picks Immediate then 2 weeks', (): void => {
    const withNotice: UserProfile = {
      ...PROFILE,
      details: {
        personal: { notice_period: '' },
        headline: '', summary: '', experience: [], education: [],
        skills: {}, languages: [], certifications: [], projects: [], answers: {}, totalYears: 0, importedAt: 1,
      },
    };
    const s = localSuggestions(withNotice, [
      d('np1', 'Notice period', { type: 'select', options: ['Immediate', '2 weeks', '1 month'] }),
      d('np2', 'Notice period', { type: 'select', options: ['2 weeks', '1 month'] }),
      d('np3', 'Notice period', { type: 'select', options: ['1 month', '3 months'] }),
    ]);
    expect(s['np1']?.value).toBe('Immediate');
    expect(s['np1']?.source).toBe('profile');
    expect(s['np2']?.value).toBe('2 weeks');
    expect(s['np2']?.source).toBe('profile');
    expect(s['np3']?.value).toBe('');
    expect(s['np3']?.source).toBe('none');
  });

  it('localSuggestions notice period text field gets Immediately', (): void => {
    const withNotice: UserProfile = {
      ...PROFILE,
      details: {
        personal: { notice_period: '' },
        headline: '', summary: '', experience: [], education: [],
        skills: {}, languages: [], certifications: [], projects: [], answers: {}, totalYears: 0, importedAt: 1,
      },
    };
    const s = localSuggestions(withNotice, [
      d('np_text', 'Notice period', { type: 'text' }),
      d('np_search', 'Notice period', { type: 'search' }),
    ]);
    expect(s['np_text']?.value).toBe('Immediately');
    expect(s['np_text']?.source).toBe('profile');
    expect(s['np_search']?.value).toBe('Immediately');
    expect(s['np_search']?.source).toBe('profile');
  });

  it('localSuggestions gender select picks profile value', (): void => {
    const withGender: UserProfile = {
      ...PROFILE,
      details: {
        personal: { gender: 'male' },
        headline: '', summary: '', experience: [], education: [],
        skills: {}, languages: [], certifications: [], projects: [], answers: {}, totalYears: 0, importedAt: 1,
      },
    };
    const s = localSuggestions(withGender, [
      d('gender', 'Gender', { type: 'select', options: ['Male', 'Female'] }),
    ]);
    expect(s['gender']?.value).toBe('Male');
    expect(s['gender']?.source).toBe('profile');
  });

  it('localSuggestions language level fields propagate English level', (): void => {
    const withLangs: UserProfile = {
      ...PROFILE,
      details: {
        personal: {},
        headline: '', summary: '', experience: [], education: [],
        skills: {}, languages: [{ language: 'English', level: 'fluent' }],
        certifications: [], projects: [], answers: {}, totalYears: 0, importedAt: 1,
      },
    };
    const s = localSuggestions(withLangs, [
      d('eng_written', 'English written level'),
      d('eng_spoken', 'English spoken'),
      d('eng_reading', 'English reading'),
      d('pol_level', 'Polish level'),
      d('written_lvl', 'Written level'),
      d('langs', 'Languages'),
    ]);
    expect(s['eng_written']?.value).toBe('fluent');
    expect(s['eng_spoken']?.value).toBe('fluent');
    expect(s['eng_reading']?.value).toBe('fluent');
    expect(s['pol_level']?.value).toBe('');
    expect(s['written_lvl']?.value).toBe('fluent');
    expect(s['langs']?.value).toBe('English');
  });

  it('localSuggestions current employer at Google returns No', (): void => {
    const withExp: UserProfile = {
      ...PROFILE,
      details: {
        personal: {},
        headline: '',
        summary: '',
        experience: [
          { company: 'Dell', title: '', location: '', employmentType: '', start: '2020-01', end: 'present', bullets: [] },
          { company: 'Nokia', title: '', location: '', employmentType: '', start: '2018-01', end: '2019-12', bullets: [] },
        ],
        education: [],
        skills: {},
        languages: [],
        certifications: [],
        projects: [],
        answers: {},
        totalYears: 0,
        importedAt: 1,
      },
    };
    const s = localSuggestions(withExp, [
      d('ce', 'Are you currently working at Google?', { type: 'select', options: ['Yes', 'No'] }),
    ], { company: 'Google' });
    expect(s['ce']?.value).toBe('No');
    expect(s['ce']?.source).toBe('profile');
  });

  it('localSuggestions current employer at Dell returns Yes', (): void => {
    const withExp: UserProfile = {
      ...PROFILE,
      details: {
        personal: {},
        headline: '',
        summary: '',
        experience: [
          { company: 'Dell', title: '', location: '', employmentType: '', start: '2020-01', end: 'present', bullets: [] },
          { company: 'Nokia', title: '', location: '', employmentType: '', start: '2018-01', end: '2019-12', bullets: [] },
        ],
        education: [],
        skills: {},
        languages: [],
        certifications: [],
        projects: [],
        answers: {},
        totalYears: 0,
        importedAt: 1,
      },
    };
    const s = localSuggestions(withExp, [
      d('ce', 'Are you currently working at Dell?', { type: 'select', options: ['Yes', 'No'] }),
    ], { company: 'Dell' });
    expect(s['ce']?.value).toBe('Yes');
    expect(s['ce']?.source).toBe('profile');
  });

  it('localSuggestions location preference combines location and work mode', (): void => {
    const withLocMode: UserProfile = {
      ...PROFILE,
      details: {
        personal: { location: 'Warsaw, Poland', work_mode: 'hybrid (2-3 days from the office)' },
        headline: '', summary: '', experience: [], education: [],
        skills: {}, languages: [], certifications: [], projects: [], answers: {}, totalYears: 0, importedAt: 1,
      },
    };
    const s = localSuggestions(withLocMode, [
      d('lp', 'What are your preferences regarding location and the way of working?', { type: 'textarea' }),
    ]);
    expect(s['lp']?.value).toBe('Warsaw, Poland. Hybrid (2-3 days from the office).');
  });

  it('localSuggestions location preference select matches work mode option', (): void => {
    const withMode: UserProfile = {
      ...PROFILE,
      details: {
        personal: { work_mode: 'hybrid' },
        headline: '', summary: '', experience: [], education: [],
        skills: {}, languages: [], certifications: [], projects: [], answers: {}, totalYears: 0, importedAt: 1,
      },
    };
    const s = localSuggestions(withMode, [
      d('wm', 'Preferred work mode', { type: 'select', options: ['Remote', 'Hybrid', 'On-site'] }),
    ]);
    expect(s['wm']?.value).toBe('Hybrid');
  });

  it('localSuggestions work model yes/no, office frequency and permit defaults', (): void => {
    const withMode: UserProfile = {
      ...PROFILE,
      details: {
        personal: { work_mode: 'hybrid (2-3 days from the office)' },
        headline: '', summary: '', experience: [], education: [],
        skills: {}, languages: [], certifications: [], projects: [], answers: {}, totalYears: 0, importedAt: 1,
      },
    };
    const s = localSuggestions(withMode, [
      d('wm', 'Would you be able to work in a hybrid work model?', { type: 'select', options: ['Yes', 'No'] }),
      d('of', 'How often would you be able to work from the office?', { type: 'text' }),
      d('wp', 'Would you require a work permit to work in Google?', { type: 'select', options: ['Yes', 'No'] }),
    ]);
    expect(s['wm']?.value).toBe('Yes'); // work-model yes/no beats the location-pref select-match
    expect(s['of']?.value).toBe('2-3 days from the office');
    expect(s['wp']?.value).toBe('No');
  });

  it('buildFillPayload maps to the server snake_case schema', (): void => {
    const body = buildFillPayload(DESCRIPTORS, { title: 'Dev', url: 'https://x' }, PROFILE, 'nvapi-user');
    expect(body['api_key']).toBe('nvapi-user');
    const profile = body['profile'] as Record<string, unknown>;
    expect(profile['full_name']).toBe('Ada King Lovelace');
    expect(profile['resume']).toContain('Analytical');
    const fields = body['fields'] as Array<Record<string, unknown>>;
    expect(fields).toHaveLength(5);
    expect(fields[3]).toMatchObject({ id: 'why', type: 'textarea', max_length: 500 });
    expect(fields[0]).not.toHaveProperty('selector');
    expect(buildFillPayload(DESCRIPTORS, undefined, null, null)).not.toHaveProperty('api_key');
  });

  it('sends structured fields from an imported Markdown CV', (): void => {
    const withDetails: UserProfile = {
      ...PROFILE,
      details: {
        personal: { first_name: 'Ada', middle_name: 'King', last_name: 'Lovelace', linkedin: 'https://li/ada', note: 'x' },
        headline: '', summary: '', experience: [], education: [], skills: {}, languages: [],
        certifications: [], projects: [], answers: { 'Why us?': 'Because.', 'Empty?': '' },
        totalYears: 7.5, importedAt: 1,
      },
    };
    const profile = buildFillPayload(DESCRIPTORS, undefined, withDetails, null)['profile'] as Record<string, unknown>;
    expect(profile).toMatchObject({
      first_name: 'Ada', middle_name: 'King', last_name: 'Lovelace', linkedin: 'https://li/ada',
      years_experience: 7.5, answers: { 'Why us?': 'Because.' },
    });
    expect(profile).not.toHaveProperty('note');
    const local = localSuggestions(withDetails, [d('mid', 'Middle name'), d('li', 'LinkedIn URL')]);
    expect(local['mid']?.value).toBe('King');
    expect(local['li']?.value).toBe('https://li/ada');
  });

  it('sends skills in priority order and fills skill fields offline by job relevance', (): void => {
    const withSkills: UserProfile = {
      ...PROFILE,
      details: {
        personal: {}, headline: '', summary: '', experience: [], education: [],
        skills: { Core: ['Python', 'Pytest'], Web: ['Selenium WebDriver', 'Java 8'] },
        languages: [], certifications: [], projects: [], answers: {}, totalYears: 0, importedAt: 1,
      },
    };
    const payload = buildFillPayload(DESCRIPTORS, undefined, withSkills, null)['profile'] as Record<string, unknown>;
    expect(payload['skills']).toEqual(['Python', 'Pytest', 'Selenium WebDriver', 'Java 8']);
    const s = localSuggestions(withSkills, [d('k', 'Key skills', { maxLength: 22 }), d('s1', 'Skill 1')], {
      title: 'Java Tester', description: 'Selenium',
    });
    expect(s['s1']?.value).toBe('Java 8');
    expect(s['k']?.value).toBe('Java 8, Python, Pytest');
  });

  it('never puts a short profile value into a long text box', (): void => {
    const s = localSuggestions(PROFILE, [
      d('about', 'About Yourself', { type: 'textarea', profileKey: 'phone' }),
      d('cover', 'Cover letter', { type: 'textarea', profileKey: 'headline' }),
      d('sum', 'Professional Summary', { type: 'textarea', profileKey: 'summary' }),
    ]);
    expect(s['about']?.value).toBe('');
    expect(s['cover']?.value).toBe('');
    expect(s['sum']?.value).toBe('Built engines');
  });

  it('answersToSuggestions keeps worker/model metadata', (): void => {
    const s = answersToSuggestions({
      why: { value: 'Because', confidence: 0.8, source: 'ai', model: 'm', worker_id: 7 },
      bad: { nope: 1 },
    });
    expect(s).toEqual({ why: { value: 'Because', confidence: 0.8, source: 'ai', model: 'm', workerId: 7 } });
  });

  it('isAiSuggestRequest validates the message shape', (): void => {
    expect(isAiSuggestRequest({ type: 'AI_SUGGEST', descriptors: [] })).toBe(true);
    expect(isAiSuggestRequest({ type: 'AI_SUGGEST' })).toBe(false);
    expect(isAiSuggestRequest({ type: 'AI_SUGGEST', descriptors: [], serverBaseUrl: 1 })).toBe(false);
  });

  it('suggestWithFallback posts to /fill and merges server answers', async (): Promise<void> => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('http://127.0.0.1:8000/fill');
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect((body['fields'] as unknown[]).length).toBe(5);
      return new Response(
        JSON.stringify({
          status: 'ok',
          data: {
            answers: {
              first: { value: 'Ada', confidence: 1, source: 'profile' },
              why: { value: 'I love engines', confidence: 0.7, source: 'ai', model: 'big', worker_id: 3 },
              yrs: { value: '', confidence: 0, source: 'none', error: 'NvidiaUpstreamError' },
            },
            stats: { total_fields: 5, profile_fields: 1, ai_tasks: 2, workers_used: 2, models_used: ['big'], duration_ms: 900 },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await suggestWithFallback(DESCRIPTORS, { url: 'https://x' });
    expect(result.offline).toBe(false);
    expect(result.suggestions['why']).toMatchObject({ value: 'I love engines', workerId: 3 });
    expect(result.suggestions['last']?.value).toBe('Lovelace'); // local value kept
    expect(result.suggestions['yrs']?.error).toBe('NvidiaUpstreamError');
    expect(result.stats?.workers_used).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('suggestWithFallback falls back to profile values when the server is down', async (): Promise<void> => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    const result = await suggestWithFallback(DESCRIPTORS, undefined);
    expect(result.offline).toBe(true);
    expect(result.reason).toMatch(/local AI server isn't running at 127\.0\.0\.1:8000.*start-server\.bat/);
    expect(result.suggestions['mail']?.value).toBe('ada@example.com');
  });

  it('uses the saved server URL when the caller passes none', async (): Promise<void> => {
    installChrome({ rbg_profile: PROFILE, rbg_server_url: 'https://my-app.fly.dev' });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'error', message: 'x', code: 'INVALID_KEY' }), { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await suggestWithFallback(DESCRIPTORS, undefined);
    expect(fetchMock).toHaveBeenCalledWith('https://my-app.fly.dev/fill', expect.anything());
    expect(result.offline).toBe(true); // 403 -> local fallback
  });

  it('consent off: profile text never leaves the device', async (): Promise<void> => {
    installChrome({ rbg_profile: PROFILE, rbg_fill_prefs: { aiProfileConsent: false } });
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await suggestWithFallback(DESCRIPTORS, { url: 'https://x' });
    expect(result.offline).toBe(true);
    expect(result.reason).toContain('consent');
    expect(result.suggestions['mail']?.value).toBe('ada@example.com'); // profile match still fills
    expect(result.suggestions['why']?.value).toBe(''); // no AI answer
    expect(fetchMock).not.toHaveBeenCalled(); // nothing sent to the server
  });

  it('surfaces the server error code', async (): Promise<void> => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ status: 'error', message: 'x', code: 'INVALID_KEY' }), { status: 403 }),
    ));
    const result = await suggestWithFallback(DESCRIPTORS, undefined);
    expect(result.offline).toBe(true);
    expect(result.reason).toBe('fill failed with status 403 (INVALID_KEY)');
  });
});

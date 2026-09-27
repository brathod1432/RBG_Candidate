// client/src/profile/languages.test.ts
import { describe, expect, it } from 'vitest';
import type { FieldDescriptor } from '../types/index';
import { languageOf, planLanguageValues, profileLevel } from './languages';

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

describe('language level planning', (): void => {
  const languages = [
    { language: 'English', level: 'fluent' },
    { language: 'Polish', level: 'intermediate' },
    { language: 'German', level: 'A2' },
  ];

  it('sibling propagation: all English level fields get the same level', (): void => {
    const out = planLanguageValues(languages, [
      d('eng_written', 'English written level'),
      d('eng_spoken', 'English spoken'),
      d('eng_reading', 'English reading'),
    ]);
    expect(out['eng_written']).toBe('fluent');
    expect(out['eng_spoken']).toBe('fluent');
    expect(out['eng_reading']).toBe('fluent');
  });

  it('Polish level field gets Polish level', (): void => {
    const out = planLanguageValues(languages, [d('pol_level', 'Polish level')]);
    expect(out['pol_level']).toBe('intermediate');
  });

  it('select English level matches option', (): void => {
    const out = planLanguageValues(
      [{ language: 'English', level: 'native' }],
      [d('eng_sel', 'English level', { type: 'select', options: ['Native', 'Fluent', 'Intermediate'] })],
    );
    expect(out['eng_sel']).toBe('Native');
  });

  it('level field naming no language defaults to English', (): void => {
    const out = planLanguageValues(
      [{ language: 'English', level: 'fluent' }],
      [d('written_lvl', 'Written level')],
    );
    expect(out['written_lvl']).toBe('fluent');
  });

  it('generic Languages field gets top language', (): void => {
    const out = planLanguageValues(languages, [d('langs', 'Languages')]);
    expect(out['langs']).toBe('English');
  });

  it('no profile languages still defaults English to C2', (): void => {
    const out = planLanguageValues([], [d('eng_written', 'English written level')]);
    expect(out['eng_written']).toContain('C2');
  });

  it('non-language field not in output', (): void => {
    const out = planLanguageValues(languages, [d('fn', 'First name')]);
    expect(out).toEqual({});
  });

  it('languageOf detects english', (): void => {
    expect(languageOf('English written level')).toBe('english');
    expect(languageOf('English spoken proficiency')).toBe('english');
    expect(languageOf('First name')).toBeNull();
  });

  it('profileLevel returns correct level', (): void => {
    expect(profileLevel(languages, 'english')).toBe('fluent');
    expect(profileLevel(languages, 'polish')).toBe('intermediate');
    expect(profileLevel(languages, 'german')).toBe('A2');
    expect(profileLevel(languages, 'spanish')).toBeNull();
  });

  it('select with no matching option leaves field for AI', (): void => {
    const out = planLanguageValues(
      [{ language: 'English', level: 'fluent' }],
      [d('eng_sel', 'English level', { type: 'select', options: ['Native', 'Intermediate'] })],
    );
    // 'fluent' doesn't match 'Native' or 'Intermediate' -> no output
    expect(out['eng_sel']).toBeUndefined();
  });

  it('generic language dropdown with no profile level leaves field for AI', (): void => {
    const out = planLanguageValues(
      [{ language: 'Polish', level: 'intermediate' }], // no English
      [d('lang_sel', 'Language', { type: 'select', options: ['English', 'Polish'] })],
    );
    // generic language dropdown, no English level in profile -> no output
    expect(out['lang_sel']).toBeUndefined();
  });

  it('respects maxLength', (): void => {
    const out = planLanguageValues(
      [{ language: 'English', level: 'very long level description that exceeds limit' }],
      [d('eng_lvl', 'English level', { maxLength: 10 })],
    );
    expect(out['eng_lvl'].length).toBeLessThanOrEqual(10);
  });
});

describe('CEFR level ladder', (): void => {
  it('C2 matches the Native option', (): void => {
    const out = planLanguageValues(
      [{ language: 'English', level: 'C2 (full professional proficiency)' }],
      [d('eng', 'What is your English level?', { type: 'select', options: ['Native', 'Fluent', 'Intermediate'] })],
    );
    expect(out['eng']).toBe('Native');
  });

  it('A2 matches Limited working proficiency (not Basic)', (): void => {
    const out = planLanguageValues(
      [{ language: 'Polish', level: 'A2 (limited working proficiency)' }],
      [
        d('pol', 'What is your Polish level?', {
          type: 'select',
          options: ['Native', 'Fluent', 'Limited working proficiency', 'Basic'],
        }),
      ],
    );
    expect(out['pol']).toBe('Limited working proficiency');
  });

  it('no profile English: defaults to Native when available, else Fluent', (): void => {
    const native = planLanguageValues(
      [],
      [d('eng', 'What is your English level?', { type: 'select', options: ['Native', 'Fluent'] })],
    );
    expect(native['eng']).toBe('Native');
    const fluent = planLanguageValues(
      [],
      [d('eng', 'What is your English level?', { type: 'select', options: ['Fluent', 'Intermediate'] })],
    );
    expect(fluent['eng']).toBe('Fluent');
  });

  it('generic Languages text field defaults to English with no profile', (): void => {
    const out = planLanguageValues([], [d('lang', 'Languages')]);
    expect(out['lang']).toBe('English');
  });

  it('generic language dropdown with no profile level still leaves the field for the AI', (): void => {
    const out = planLanguageValues(
      [{ language: 'Polish', level: 'intermediate' }],
      [d('lang_sel', 'Language', { type: 'select', options: ['English', 'Polish'] })],
    );
    expect(out['lang_sel']).toBeUndefined();
  });
});
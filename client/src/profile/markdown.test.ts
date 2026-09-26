// client/src/profile/markdown.test.ts
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
  detailsFromProfile,
  durationYears,
  normalizeDate,
  parseProfileMarkdown,
  profileFromDetails,
  profileToMarkdown,
  renderResumeText,
  totalExperienceYears,
} from './markdown';
import { PROFILE_TEMPLATE } from './template';

const NOW = new Date('2026-09-01T00:00:00Z');

const FILLED = `# RBG Candidate Profile
<!-- comment with - Fake: value -->
## Personal
- First name: Ada
- Middle name: King
- Last name: Lovelace
- Email: ada@example.com
- Phone: +44 20 7946 0000
- City: London
- Country: United Kingdom
- LinkedIn: https://linkedin.com/in/ada
- GitHub: https://github.com/ada
- Requires visa sponsorship: No
- Notice period: 1 month
- Favourite colour: green

## Headline
Senior Software Engineer — Python & AI

## Summary
Ten years building analytical engines.
Loves async Python.

## Experience

### Job 1
- Company: Analytical Engines Ltd
- Title: Senior Engineer
- Location: London
- Start: 2020-01
- End: present
- Cut latency by 40%: by caching results
- Led a team of 5

### Babbage & Co — Engineer
- Dates: Mar 2016 – Dec 2019
- Built the difference engine UI

### Job 3
- Company:
- Title:

## Education
### School 1
- School: University of London
- Degree: BSc
- Field of study: Mathematics
- Start: 2012
- End: 2015
- Grade: First

## Skills
- Programming languages: Python, TypeScript; Rust
- Frameworks: FastAPI, React

## Languages
- English: Native
- French (Fluent)

## Certifications
- AWS Certified Developer

## Projects
### Project 1
- Name: Engine Sim
- Link: https://example.com/sim
- Simulates the analytical engine

## Answers
- Why are you looking for a new role?: I want to build AI products.
- What are you most proud of?:

## Hobbies
Chess and sailing
`;

describe('markdown profile', (): void => {
  it('docs/profile-template.md matches the bundled template', (): void => {
    const doc = readFileSync(new URL('../../../docs/profile-template.md', import.meta.url), 'utf8');
    expect(doc).toBe(PROFILE_TEMPLATE);
  });

  it('the empty template parses to empty data with warnings', (): void => {
    const { details, warnings } = parseProfileMarkdown(PROFILE_TEMPLATE, NOW);
    expect(details.experience).toEqual([]);
    expect(details.education).toEqual([]);
    expect(details.projects).toEqual([]);
    expect(details.personal).toEqual({});
    expect(details.answers).toEqual({});
    expect(warnings).toContain('First name is empty.');
  });

  it('parses a filled CV', (): void => {
    const { details: d, warnings } = parseProfileMarkdown(FILLED, NOW);
    expect(d.personal).toMatchObject({
      first_name: 'Ada', middle_name: 'King', last_name: 'Lovelace', email: 'ada@example.com',
      city: 'London', location: 'London, United Kingdom', linkedin: 'https://linkedin.com/in/ada',
      visa_sponsorship: 'No', notice_period: '1 month', favourite_colour: 'green',
    });
    expect(d.personal['fake']).toBeUndefined(); // HTML comments ignored
    expect(d.headline).toBe('Senior Software Engineer — Python & AI');
    expect(d.summary).toBe('Ten years building analytical engines. Loves async Python.');
    expect(d.experience).toHaveLength(2); // empty "Job 3" dropped
    expect(d.experience[0]).toMatchObject({ company: 'Analytical Engines Ltd', title: 'Senior Engineer', start: '2020-01', end: 'present' });
    expect(d.experience[0]?.bullets).toEqual(['Cut latency by 40%: by caching results', 'Led a team of 5']);
    expect(d.experience[1]).toMatchObject({ company: 'Babbage & Co', title: 'Engineer', start: '2016-03', end: '2019-12' });
    expect(d.education[0]).toMatchObject({ school: 'University of London', degree: 'BSc', field: 'Mathematics', start: '2012', end: '2015', grade: 'First' });
    expect(d.skills['Programming languages']).toEqual(['Python', 'TypeScript', 'Rust']);
    expect(d.languages).toEqual([{ language: 'English', level: 'Native' }, { language: 'French', level: 'Fluent' }]);
    expect(d.certifications).toEqual(['AWS Certified Developer']);
    expect(d.projects[0]).toMatchObject({ name: 'Engine Sim', link: 'https://example.com/sim', bullets: ['Simulates the analytical engine'] });
    expect(d.answers).toEqual({ 'Why are you looking for a new role?': 'I want to build AI products.', Hobbies: 'Chess and sailing' });
    expect(d.totalYears).toBe(10.6); // 2016-03..2026-09 contiguous = 127 months
    expect(warnings).toEqual([]);
  });

  it('builds the popup profile + AI resume text', (): void => {
    const { details } = parseProfileMarkdown(FILLED, NOW);
    const p = profileFromDetails(details, NOW);
    expect(p.fullName).toBe('Ada King Lovelace');
    expect(p.email).toBe('ada@example.com');
    expect(p.headline).toBe('Senior Software Engineer — Python & AI');
    expect(p.resume).toContain('Total professional experience: 10.6 years');
    expect(p.resume).toContain('- Senior Engineer at Analytical Engines Ltd (London), 2020-01 – present (6.8 years)');
    expect(p.resume).toContain('Skills: Programming languages: Python, TypeScript, Rust');
    expect(p.resume).toContain('Q: Why are you looking for a new role?\nA: I want to build AI products.');
    expect(p.details).toBe(details);
  });

  it('round-trips through export', (): void => {
    const { details } = parseProfileMarkdown(FILLED, NOW);
    const again = parseProfileMarkdown(profileToMarkdown(details), NOW).details;
    expect({ ...again, importedAt: 0 }).toEqual({ ...details, importedAt: 0 });
  });

  it('exports a hand-typed profile', (): void => {
    const d = detailsFromProfile({
      fullName: 'Ada Lovelace', email: 'a@b.c', phone: null, headline: 'Eng', summary: 'Sum',
      resume: 'Worked at X', updatedAt: 1,
    });
    const md = profileToMarkdown(d);
    expect(md).toContain('- First name: Ada');
    expect(md).toContain('## Notes');
    const back = parseProfileMarkdown(md, NOW).details;
    expect(back.personal['last_name']).toBe('Lovelace');
    expect(back.answers['Notes']).toBe('Worked at X');
  });

  it('dates and durations', (): void => {
    expect(normalizeDate('03/2021')).toBe('2021-03');
    expect(normalizeDate('March 2021')).toBe('2021-03');
    expect(normalizeDate('2021-3-15')).toBe('2021-03');
    expect(normalizeDate('Current')).toBe('present');
    expect(normalizeDate('soon')).toBe('soon');
    expect(durationYears('2020-01', '2020-12', NOW)).toBe(1);
    expect(totalExperienceYears([
      { company: 'a', title: '', location: '', employmentType: '', start: '2020-01', end: '2021-12', bullets: [] },
      { company: 'b', title: '', location: '', employmentType: '', start: '2021-01', end: '2022-12', bullets: [] },
    ], NOW)).toBe(3);
  });
  it('keeps big profiles under the limit by dropping low-value detail, not whole sections', (): void => {
    const job = (n: number) => ({
      company: `Co ${n}`, title: 'Engineer', location: '', employmentType: '', start: '2020-01', end: '2021-01',
      bullets: Array.from({ length: 30 }, (_, i) => `Did important thing ${i} `.repeat(6)),
    });
    const big = {
      personal: {}, headline: '', summary: '', experience: [job(1), job(2), job(3)], education: [],
      skills: { Core: ['Python'] }, languages: [{ language: 'English', level: 'C2' }], certifications: [],
      projects: [{ name: 'Last project', link: '', bullets: ['x '.repeat(400)] }],
      answers: { 'Why?': 'y'.repeat(2000) }, totalYears: 1, importedAt: 1,
    };
    const text = renderResumeText(big, new Date('2026-01-01'), 8000);
    expect(text.length).toBeLessThanOrEqual(8000);
    expect(text).toContain('Languages: English (C2)');
    expect(text).toContain('- Last project');
    expect(text).not.toContain('Prepared answers');
  });
});

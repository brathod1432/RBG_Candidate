// client/src/content/describe.test.ts
// @vitest-environment jsdom
// Radio-group + checkbox descriptors (choice mapping), their fill application,
// and the typeahead pick (skills / company / university pickers).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { describeFields } from './describe';
import { fillCheckedFieldsInPage } from './fill';
import { pickTypeaheadOption } from './typeahead';

describe('describeFields radio + checkbox', (): void => {
  beforeAll((): void => {
    // jsdom has no layout: getClientRects() is always empty, which describeFields
    // reads as invisible. Give every element a fake rect so the scan sees them.
    Object.defineProperty(Element.prototype, 'getClientRects', {
      configurable: true,
      value: () => [{ width: 1, height: 1 }] as unknown as DOMRectList,
    });
  });

  afterEach((): void => {
    document.body.innerHTML = '';
  });

  it('one descriptor per radio group with the group labels as options', (): void => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <legend>Gender</legend>
          <label><input type="radio" name="gender" value="male" /> Male</label>
          <label><input type="radio" name="gender" value="female" /> Female</label>
        </fieldset>
        <input name="email" type="email" aria-label="Your email">
      </form>`;
    const fields = describeFields(document.body);
    const gender = fields.filter((f) => (f.label ?? '').toLowerCase().includes('gender'));
    expect(gender).toHaveLength(1);
    expect(gender[0]?.type).toBe('select');
    expect(gender[0]?.options).toEqual(['Male', 'Female']);
    // the sibling radio did not produce its own descriptor
    expect(fields.filter((f) => f.id.includes('gender'))).toHaveLength(1);
    expect(fields.some((f) => f.type === 'email')).toBe(true);
  });

  it('checkbox is a binary select with Yes/No options', (): void => {
    document.body.innerHTML = `
      <form>
        <label><input type="checkbox" name="auth" /> Authorized to work?</label>
      </form>`;
    const fields = describeFields(document.body);
    expect(fields).toHaveLength(1);
    expect(fields[0]?.type).toBe('select');
    expect(fields[0]?.options).toEqual(['Yes', 'No']);
  });
});

describe('fillCheckedFieldsInPage radio + checkbox', (): void => {
  afterEach((): void => {
    document.body.innerHTML = '';
  });

  it('picks the radio whose label matches the value', (): void => {
    document.body.innerHTML = `
      <form>
        <label><input type="radio" name="gender" value="male" /> Male</label>
        <label><input type="radio" name="gender" value="female" /> Female</label>
      </form>`;
    const n = fillCheckedFieldsInPage({
      values: { gender: 'Female' },
      selectors: { gender: 'input[name="gender"]' },
    });
    expect(n).toBe(1);
    const checked = document.querySelector('input[name="gender"]:checked') as HTMLInputElement;
    expect(checked.value).toBe('female');
  });

  it('checks and unchecks a checkbox from Yes/No answers', (): void => {
    document.body.innerHTML = `<form><input type="checkbox" name="auth"></form>`;
    const n1 = fillCheckedFieldsInPage({ values: { auth: 'Yes' }, selectors: { auth: 'input[name="auth"]' } });
    expect(n1).toBe(1);
    expect((document.querySelector('input[name="auth"]') as HTMLInputElement).checked).toBe(true);
    const n2 = fillCheckedFieldsInPage({ values: { auth: 'No' }, selectors: { auth: 'input[name="auth"]' } });
    expect(n2).toBe(1);
    expect((document.querySelector('input[name="auth"]') as HTMLInputElement).checked).toBe(false);
  });

  it('leaves a checkbox alone for a non-yes/no answer', (): void => {
    document.body.innerHTML = `<form><input type="checkbox" name="auth"></form>`;
    const n = fillCheckedFieldsInPage({ values: { auth: 'maybe' }, selectors: { auth: 'input[name="auth"]' } });
    expect(n).toBe(0);
    expect((document.querySelector('input[name="auth"]') as HTMLInputElement).checked).toBe(false);
  });
});

describe('typeahead pick (skills / company / university pickers)', (): void => {
  afterEach((): void => {
    document.body.innerHTML = '';
  });

  it('clicks the matching option from the appeared list', async (): Promise<void> => {
    document.body.innerHTML = `
      <form>
        <input name="company" type="text">
        <ul class="autocomplete" id="company-list">
          <li>Dell Technologies</li>
          <li>Dell India</li>
          <li>Somewhere Else</li>
        </ul>
      </form>`;
    const list = document.getElementById('company-list') as HTMLElement;
    list.getClientRects = () => [{ width: 1, height: 1 }] as unknown as DOMRectList;
    const clicked: string[] = [];
    list.addEventListener('click', (e) => clicked.push((e.target as HTMLElement).textContent ?? ''));
    const ok = await pickTypeaheadOption(
      document.querySelector('input[name="company"]') as HTMLInputElement,
      'Dell',
    );
    expect(ok).toBe(true);
    expect(clicked).toEqual(['Dell Technologies']); // startsWith("dell"), first match
  });

  it('clicks the option matching the last-typed segment of a skill list', async (): Promise<void> => {
    document.body.innerHTML = `
      <form>
        <input name="skills" type="text">
        <ul class="dropdown-menu">
          <li>Pytest</li>
          <li>Robot Framework</li>
        </ul>
      </form>`;
    const list = document.querySelector('.dropdown-menu') as HTMLElement;
    list.getClientRects = () => [{ width: 1, height: 1 }] as unknown as DOMRectList;
    const clicked: string[] = [];
    list.addEventListener('click', (e) => clicked.push((e.target as HTMLElement).textContent ?? ''));
    const ok = await pickTypeaheadOption(
      document.querySelector('input[name="skills"]') as HTMLInputElement,
      'Python, Pytest',
    );
    expect(ok).toBe(true);
    expect(clicked).toEqual(['Pytest']); // segments are tried last-typed first
  });

  it('gives up cleanly when no list appears', async (): Promise<void> => {
    document.body.innerHTML = `<form><input name="plain" type="text"></form>`;
    const ok = await pickTypeaheadOption(
      document.querySelector('input[name="plain"]') as HTMLInputElement,
      'anything',
    );
    expect(ok).toBe(false);
  });
});

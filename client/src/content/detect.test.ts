// client/src/content/detect.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import type { FieldMap, StageHint } from '../types/index';
import {
  buildPromptSnippet,
  detectStage,
  PROMPT_SNIPPET_MAX_CHARS,
  scanFields,
} from './detect';

type LabelLike = { textContent: string };

class FakeInputControl {
  readonly tagName: string = 'INPUT';
  type: string;
  disabled: boolean;
  id: string;
  private readonly attrs: Map<string, string>;
  private readonly wrappingLabelText: string;

  constructor(
    inputType: string,
    id: string,
    attrs: Map<string, string>,
    wrappingLabelText: string,
    disabled: boolean,
  ) {
    this.type = inputType;
    this.id = id;
    this.attrs = attrs;
    this.wrappingLabelText = wrappingLabelText;
    this.disabled = disabled;
  }

  getAttribute(name: string): string | null {
    const value: string | undefined = this.attrs.get(name);
    return value ?? null;
  }

  closest(selector: string): LabelLike | null {
    if (selector === 'label' && this.wrappingLabelText !== '') {
      return { textContent: this.wrappingLabelText };
    }
    return null;
  }
}

class FakeSelectControl {
  readonly tagName: string = 'SELECT';
  disabled: boolean;
  id: string;
  private readonly attrs: Map<string, string>;
  private readonly wrappingLabelText: string;

  constructor(
    id: string,
    attrs: Map<string, string>,
    wrappingLabelText: string,
    disabled: boolean,
  ) {
    this.id = id;
    this.attrs = attrs;
    this.wrappingLabelText = wrappingLabelText;
    this.disabled = disabled;
  }

  getAttribute(name: string): string | null {
    const value: string | undefined = this.attrs.get(name);
    return value ?? null;
  }

  closest(selector: string): LabelLike | null {
    if (selector === 'label' && this.wrappingLabelText !== '') {
      return { textContent: this.wrappingLabelText };
    }
    return null;
  }
}

class FakeTextAreaControl {
  readonly tagName: string = 'TEXTAREA';
  disabled: boolean;
  id: string;
  private readonly attrs: Map<string, string>;
  private readonly wrappingLabelText: string;

  constructor(
    id: string,
    attrs: Map<string, string>,
    wrappingLabelText: string,
    disabled: boolean,
  ) {
    this.id = id;
    this.attrs = attrs;
    this.wrappingLabelText = wrappingLabelText;
    this.disabled = disabled;
  }

  getAttribute(name: string): string | null {
    const value: string | undefined = this.attrs.get(name);
    return value ?? null;
  }

  closest(selector: string): LabelLike | null {
    if (selector === 'label' && this.wrappingLabelText !== '') {
      return { textContent: this.wrappingLabelText };
    }
    return null;
  }
}

type FakeControl = FakeInputControl | FakeSelectControl | FakeTextAreaControl;

class FakeRoot {
  private dataStageValue: string | null = null;
  private headingTexts: string[] = [];
  private controls: FakeControl[] = [];
  private labelForText: Map<string, string> = new Map();
  private idText: Map<string, string> = new Map();

  setDataStage(value: string | null): void {
    this.dataStageValue = value;
  }

  setHeadings(values: string[]): void {
    this.headingTexts = values;
  }

  addControl(control: FakeControl): void {
    this.controls.push(control);
  }

  setLabelFor(id: string, text: string): void {
    this.labelForText.set(id, text);
  }

  setIdText(id: string, text: string): void {
    this.idText.set(id, text);
  }

  querySelector(selector: string): unknown {
    if (selector === '[data-stage]') {
      if (this.dataStageValue === null) {
        return null;
      }
      const value: string = this.dataStageValue;
      return {
        getAttribute: (name: string): string | null =>
          name === 'data-stage' ? value : null,
      };
    }
    if (selector.startsWith('label[for="') && selector.endsWith('"]')) {
      const id: string = selector.slice(11, selector.length - 2);
      const text: string | undefined = this.labelForText.get(id);
      if (text === undefined) {
        return null;
      }
      return { textContent: text };
    }
    if (selector.startsWith('#')) {
      const id: string = selector.slice(1);
      const text: string | undefined = this.idText.get(id);
      if (text === undefined) {
        return null;
      }
      return { textContent: text };
    }
    return null;
  }

  querySelectorAll(selector: string): unknown[] {
    if (selector === 'h1, h2, h3, legend') {
      return this.headingTexts.map(
        (text: string): LabelLike => ({ textContent: text }),
      );
    }
    if (selector === 'input, select, textarea') {
      return [...this.controls];
    }
    if (selector === 'input') {
      return this.controls.filter(
        (control: FakeControl): boolean => control.tagName === 'INPUT',
      );
    }
    if (selector === 'select') {
      return this.controls.filter(
        (control: FakeControl): boolean => control.tagName === 'SELECT',
      );
    }
    if (selector === 'textarea') {
      return this.controls.filter(
        (control: FakeControl): boolean => control.tagName === 'TEXTAREA',
      );
    }
    return [];
  }
}

interface InputInit {
  inputType?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  labelForText?: string;
  wrappingLabelText?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

interface TextAreaInit {
  id?: string;
  name?: string;
  placeholder?: string;
  labelForText?: string;
  wrappingLabelText?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

function installDomStubs(): void {
  const scope = globalThis as unknown as Record<string, unknown>;
  scope['HTMLInputElement'] = FakeInputControl;
  scope['HTMLSelectElement'] = FakeSelectControl;
  scope['HTMLTextAreaElement'] = FakeTextAreaControl;
}

function addInput(root: FakeRoot, init: InputInit): FakeInputControl {
  const id: string = init.id ?? '';
  const attrs: Map<string, string> = new Map();
  if (init.name !== undefined) {
    attrs.set('name', init.name);
  }
  if (init.placeholder !== undefined) {
    attrs.set('placeholder', init.placeholder);
  }
  if (init.ariaLabel !== undefined) {
    attrs.set('aria-label', init.ariaLabel);
  }
  const control: FakeInputControl = new FakeInputControl(
    init.inputType ?? 'text',
    id,
    attrs,
    init.wrappingLabelText ?? '',
    init.disabled ?? false,
  );
  root.addControl(control);
  if (init.labelForText !== undefined && id !== '') {
    root.setLabelFor(id, init.labelForText);
  }
  return control;
}

function addTextArea(root: FakeRoot, init: TextAreaInit): FakeTextAreaControl {
  const id: string = init.id ?? '';
  const attrs: Map<string, string> = new Map();
  if (init.name !== undefined) {
    attrs.set('name', init.name);
  }
  if (init.placeholder !== undefined) {
    attrs.set('placeholder', init.placeholder);
  }
  if (init.ariaLabel !== undefined) {
    attrs.set('aria-label', init.ariaLabel);
  }
  const control: FakeTextAreaControl = new FakeTextAreaControl(
    id,
    attrs,
    init.wrappingLabelText ?? '',
    init.disabled ?? false,
  );
  root.addControl(control);
  if (init.labelForText !== undefined && id !== '') {
    root.setLabelFor(id, init.labelForText);
  }
  return control;
}

function asParentNode(root: FakeRoot): ParentNode {
  return root as unknown as ParentNode;
}

beforeAll((): void => {
  installDomStubs();
});

describe('detectStage', (): void => {
  it('prefers data-stage over url and heading', (): void => {
    const root: FakeRoot = new FakeRoot();
    root.setDataStage('3');
    root.setHeadings(['Step 7: Review']);
    const hint: StageHint = detectStage(
      asParentNode(root),
      'https://example.com/apply?stage=5',
    );
    expect(hint.stage).toBe('3');
    expect(hint.reason).toBe('data-stage');
    expect(hint.confidence).toBe(1);
  });

  it('falls back to the url stage number', (): void => {
    const root: FakeRoot = new FakeRoot();
    const hint: StageHint = detectStage(
      asParentNode(root),
      'https://example.com/apply?stage=4',
    );
    expect(hint.stage).toBe('4');
    expect(hint.reason).toBe('url');
    expect(hint.confidence).toBe(0.7);
  });

  it('falls back to a heading stage number', (): void => {
    const root: FakeRoot = new FakeRoot();
    root.setHeadings(['Step 2: Experience']);
    const hint: StageHint = detectStage(
      asParentNode(root),
      'https://example.com/apply',
    );
    expect(hint.stage).toBe('2');
    expect(hint.reason).toBe('heading');
    expect(hint.confidence).toBe(0.5);
  });

  it('defaults to stage 1', (): void => {
    const root: FakeRoot = new FakeRoot();
    const hint: StageHint = detectStage(
      asParentNode(root),
      'https://example.com/apply',
    );
    expect(hint.stage).toBe('1');
    expect(hint.reason).toBe('default');
    expect(hint.confidence).toBe(0.2);
  });
});

describe('scanFields heuristics', (): void => {
  it('classifies an email field', (): void => {
    const root: FakeRoot = new FakeRoot();
    addInput(root, {
      id: 'email',
      name: 'email',
      placeholder: 'Email address',
    });
    const fields: FieldMap = scanFields(asParentNode(root));
    expect(fields['email']).toBe('#email');
  });

  it('classifies a phone field', (): void => {
    const root: FakeRoot = new FakeRoot();
    addInput(root, { id: 'phone', name: 'phone' });
    const fields: FieldMap = scanFields(asParentNode(root));
    expect(fields['phone']).toBe('#phone');
  });

  it('classifies a full name from its label', (): void => {
    const root: FakeRoot = new FakeRoot();
    addInput(root, { id: 'nm1', name: 'nm1', labelForText: 'Full name' });
    const fields: FieldMap = scanFields(asParentNode(root));
    expect(fields['fullName']).toBe('#nm1');
  });

  it('classifies a summary textarea', (): void => {
    const root: FakeRoot = new FakeRoot();
    addTextArea(root, { id: 'summary', name: 'summary' });
    const fields: FieldMap = scanFields(asParentNode(root));
    expect(fields['summary']).toBe('#summary');
  });

  it('excludes password inputs', (): void => {
    const root: FakeRoot = new FakeRoot();
    addInput(root, { inputType: 'password', id: 'pw', name: 'password' });
    const fields: FieldMap = scanFields(asParentNode(root));
    expect(fields).toEqual({});
  });

  it('excludes company inputs', (): void => {
    const root: FakeRoot = new FakeRoot();
    addInput(root, { id: 'company', name: 'company' });
    const fields: FieldMap = scanFields(asParentNode(root));
    expect(fields).toEqual({});
  });
});

describe('buildPromptSnippet', (): void => {
  it('keeps the snippet within 4000 chars', (): void => {
    const stage: StageHint = {
      stage: '2',
      confidence: 0.5,
      reason: 'heading',
      updatedAt: 1,
    };
    const fields: FieldMap = {};
    for (let i = 0; i < 200; i += 1) {
      fields[`field${i}`] = `#very-long-selector-name-number-${i}-` + 'x'.repeat(200);
    }
    const snippet: string = buildPromptSnippet(stage, fields);
    expect(PROMPT_SNIPPET_MAX_CHARS).toBe(4000);
    expect(snippet.length).toBeLessThanOrEqual(PROMPT_SNIPPET_MAX_CHARS);
    expect(snippet.length).toBeLessThanOrEqual(4000);
  });

  it('mentions the stage header for small inputs', (): void => {
    const stage: StageHint = {
      stage: '1',
      confidence: 0.2,
      reason: 'default',
      updatedAt: 1,
    };
    const snippet: string = buildPromptSnippet(stage, { email: '#email' });
    expect(snippet).toContain('stage=1');
    expect(snippet.length).toBeLessThanOrEqual(4000);
  });
});

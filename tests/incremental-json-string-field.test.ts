import { describe, expect, it } from 'vitest';
import { IncrementalJsonStringField } from '../src/ai/incremental-json-string-field.js';

describe('IncrementalJsonStringField', () => {
  it('emits only decoded paragraph text across arbitrary JSON chunks', () => {
    const extractor = new IncrementalJsonStringField('paragraph');
    const chunks = ['{"para', 'graph":"Hello \\', '"learner\\"', '!","translation":"中文"}'];

    expect(chunks.map((chunk) => extractor.push(chunk)).join('')).toBe('Hello "learner"!');
  });

  it('waits for complete escapes and decodes newlines and Unicode escapes', () => {
    const extractor = new IncrementalJsonStringField('paragraph');

    expect(extractor.push('{"translation":"x","paragraph":"Line\\')).toBe('Line');
    expect(extractor.push('nSnowman: \\u26')).toBe('\nSnowman: ');
    expect(extractor.push('03"}')).toBe('☃');
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeLogicalResourcePath } from '../src/resources/logical-resource-path.js';

describe('normalizeLogicalResourcePath', () => {
  it.each([
    ['uk/bit__gb_1.spx', '\\uk\\bit__gb_1.spx'],
    ['audio/日本語/東京.ogg', '\\audio\\日本語\\東京.ogg'],
    ['Audio/Test.OGG', '\\Audio\\Test.OGG'],
  ])('normalizes %s while preserving Unicode and case', (input, expected) => {
    expect(normalizeLogicalResourcePath(input)).toBe(expected);
    expect(expected.startsWith('\\') && !expected.startsWith('\\\\')).toBe(true);
  });

  it.each(['../secret', 'a/../secret', '.', 'a//b', '/absolute', '\\absolute', 'C:/absolute', 'a\\b', 'a\0b', 'a\nb'])
    ('rejects unsafe or malformed path %j', (input) => {
      expect(() => normalizeLogicalResourcePath(input)).toThrow();
    });
});

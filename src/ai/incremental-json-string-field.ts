export class IncrementalJsonStringField {
  private source = '';
  private emitted = '';

  constructor(private readonly fieldName: string) {}

  push(fragment: string): string {
    this.source += fragment;
    const current = extractJsonStringField(this.source, this.fieldName);
    if (current === null || !current.startsWith(this.emitted)) return '';
    const delta = current.slice(this.emitted.length);
    this.emitted = current;
    return delta;
  }
}

function extractJsonStringField(source: string, fieldName: string): string | null {
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '"') continue;
    const key = readJsonString(source, index, false);
    if (!key.complete) return null;
    index = key.end;
    if (key.value !== fieldName) continue;
    let cursor = skipWhitespace(source, key.end + 1);
    if (source[cursor] !== ':') continue;
    cursor = skipWhitespace(source, cursor + 1);
    if (source[cursor] !== '"') return null;
    return readJsonString(source, cursor, true).value;
  }
  return null;
}

function readJsonString(
  source: string,
  openingQuote: number,
  allowPartial: boolean,
): { value: string; end: number; complete: boolean } {
  let value = '';
  for (let index = openingQuote + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') return { value, end: index, complete: true };
    if (character !== '\\') {
      value += character;
      continue;
    }
    if (index + 1 >= source.length) break;
    const escape = source[index + 1];
    if (escape === 'u') {
      const digits = source.slice(index + 2, index + 6);
      if (digits.length < 4 || !/^[0-9a-f]{4}$/iu.test(digits)) break;
      value += String.fromCharCode(Number.parseInt(digits, 16));
      index += 5;
      continue;
    }
    const decoded = SIMPLE_ESCAPES[escape];
    if (decoded === undefined) break;
    value += decoded;
    index += 1;
  }
  return { value: allowPartial ? value : '', end: source.length, complete: false };
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (/\s/u.test(source[index] ?? '')) index += 1;
  return index;
}

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

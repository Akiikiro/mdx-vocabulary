import { describe, expect, it } from 'vitest';
import { entryPlainText, sanitizeEntryHtml } from '../src/entries/html.js';
import { transformMdictReferences } from '../src/entries/mdict-references.js';

describe('MDict reference processing', () => {
  it('creates an inert sound marker and suppresses its nested pronunciation image', () => {
    const clean = sanitizeEntryHtml('<a type="sound" topic="ignored" resource="uk_pron" class="fayin" href="sound://uk/bit__gb_1.spx"><img src="uk_pron.png" onerror="x()"></a>');
    expect(clean).toBe('<span data-mdict-kind="sound" data-mdict-resource="uk/bit__gb_1.spx"></span>');
    expect(clean).not.toContain('image');
  });

  it.each([
    ['/pic/big_tassel.png', 'pic/big_tassel.png'],
    ['/pic/猫.png', 'pic/猫.png'],
    ['Audio/Test.OGG', 'Audio/Test.OGG'],
  ])('turns image %s into a case- and Unicode-preserving logical marker', (source, resource) => {
    expect(sanitizeEntryHtml(`<img src="${source}" style="x" onclick="x()">`))
      .toBe(`<span data-mdict-kind="image" data-mdict-resource="${resource}"></span>`);
  });

  it('preserves an entry target separately from its sanitized display content', () => {
    const clean = sanitizeEntryHtml('<a href="entry://some-target" onclick="x()"><strong>displayed text</strong></a>');
    expect(clean).toBe('<span data-mdict-kind="entry" data-mdict-entry-target="some-target"><strong>displayed text</strong></span>');
    expect(entryPlainText(clean)).toBe('displayed text');
  });

  it.each([
    ['<a href="sound://audio/日本語/東京.ogg"></a>', '<span data-mdict-kind="sound" data-mdict-resource="audio/日本語/東京.ogg"></span>'],
    ['<a href="sound://Audio/Test.OGG"></a>', '<span data-mdict-kind="sound" data-mdict-resource="Audio/Test.OGG"></span>'],
    ['<a href="entry://東京">表示</a>', '<span data-mdict-kind="entry" data-mdict-entry-target="東京">表示</span>'],
  ])('supports multilingual and case-sensitive reference %s', (raw, expected) => {
    expect(sanitizeEntryHtml(raw)).toBe(expected);
  });

  it.each([
    '<a href="sound://">sound</a>',
    '<a href="sound://../secret">sound</a>',
    '<a href="sound://audio/%2e%2e/secret">sound</a>',
    '<a href="sound://audio/%00bad">sound</a>',
    '<a href="sound://audio/%ZZ">sound</a>',
    '<a href="entry://">entry</a>',
    '<a href="entry://%00bad">entry</a>',
  ])('fails closed for malformed internal reference %s', (raw) => {
    const clean = sanitizeEntryHtml(raw);
    expect(clean).not.toContain('data-mdict-');
    expect(clean).not.toMatch(/(?:sound|entry):\/\//u);
  });

  it.each(['\0', '\u0001', '\n'])('rejects literal control character %j in resource paths', (control) => {
    const clean = sanitizeEntryHtml(`<a href="sound://audio/${control}bad.ogg">sound</a><img src="pic/${control}bad.png">`);
    expect(clean).not.toContain('data-mdict-');
  });

  it.each([
    'javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///tmp/x',
    '//tracker.example/x.png', 'http://tracker.example/x.png', 'https://tracker.example/x.png',
    '../secret.png', 'a/../../secret.png',
  ])('does not preserve unsafe image src %s', (source) => {
    const clean = sanitizeEntryHtml(`<img src="${source}" onerror="alert(1)">`);
    expect(clean).toBe('');
  });

  it('does not let raw HTML forge trusted marker attributes', () => {
    const clean = sanitizeEntryHtml([
      '<span data-mdict-kind="sound" data-mdict-resource="private.bin" data-mdict-entry-target="x" onclick="x()">forged</span>',
      '<a data-mdict-kind="entry" data-mdict-entry-target="admin" href="/api/private">relative</a>',
    ].join(''));
    expect(clean).toBe('<span>forged</span><a>relative</a>');
    expect(clean).not.toContain('data-mdict-');
    expect(clean).not.toContain('onclick');
  });

  it('keeps sound/image paths out of plain text', () => {
    const clean = sanitizeEntryHtml('word<a href="sound://audio/example.ogg"><img src="icon.png"></a><img src="/pic/example.png"><a href="entry://target">visible</a>');
    expect(entryPlainText(clean)).toBe('wordvisible');
    expect(entryPlainText(clean)).not.toMatch(/(?:audio|pic|example)/u);
  });

  it('is deterministic and defines its transform stage as raw-input-only', () => {
    const raw = '<a href="sound://audio/test.ogg"><img src="icon.png"></a>';
    expect(sanitizeEntryHtml(raw)).toBe(sanitizeEntryHtml(raw));
    const transformed = transformMdictReferences(raw);
    expect(sanitizeEntryHtml(transformed)).toBe('<span></span>');
  });

  it('continues stripping scripts, event handlers, and unsafe anchor schemes', () => {
    const clean = sanitizeEntryHtml('<script>alert(1)</script><a href="javascript:x" onclick="x()">bad</a><img src="javascript:x" onerror="x()">');
    expect(clean).toBe('<a>bad</a>');
  });
});

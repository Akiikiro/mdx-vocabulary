import { describe, expect, it } from 'vitest';
import { auditMeikyoCorpus } from '../src/meikyo/meikyo-corpus-audit.js';
import { MeikyoParser, serializeMeikyoEntry } from '../src/meikyo/meikyo-parser.js';
import { StarDictReader } from '../src/stardict/stardict-reader.js';

const source = process.env.MEIKYO_DICTIONARY_DIR;

describe.skipIf(!source)('Meikyo corpus regression', () => {
  it('represents every audited record without parse or content loss', async () => {
    const summary = await auditMeikyoCorpus(source!);
    expect(summary.records).toBe(209_052);
    expect(summary.normalEntries).toBe(165_957);
    expect(summary.customLinks).toBe(43_095);
    expect(summary.parseFailures).toBe(0);
    expect(summary.contentLossFailures).toBe(0);
    expect(summary.nodes.subdivision).toBe(1_413);
    expect(summary.rawFallbackReasons.unknownStructure).toBe(4_777);
    expect(summary.rawFallbackReasons.blankLine).toBe(2_244);
    expect(summary.entriesWithRawFallback).toBe(3_266);

    const reader = await StarDictReader.open(source!);
    const required = new Set(['一生懸命', '食べる', '曖昧', 'せっかく', '覚える', 'おぼえる', 'clear', 'くる', '一人天下', 'ace', '謂ウ']);
    const found = new Map(Array.from(reader.records()).filter((record) => required.has(record.headword)).map((record) => [record.headword, record]));
    expect(Array.from(found.keys()).sort()).toEqual(Array.from(required).sort());
    const longest = found.get('謂ウ')!;
    expect(longest.size).toBe(16_527);
    const parsed = new MeikyoParser().parse(longest);
    expect(serializeMeikyoEntry(parsed)).toBe(longest.text);
    expect(parsed.kind === 'entry' ? parsed.nodes.filter((node) => node.type === 'definition').length : 0).toBe(7);
  }, 60_000);
});

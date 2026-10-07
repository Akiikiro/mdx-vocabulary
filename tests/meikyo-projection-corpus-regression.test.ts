import { describe, expect, it } from 'vitest';
import { projectMeikyoEntry } from '../src/meikyo/meikyo-canonical-projector.js';
import { auditMeikyoCanonicalProjection } from '../src/meikyo/meikyo-projection-audit.js';
import { MeikyoParser } from '../src/meikyo/meikyo-parser.js';
import { StarDictReader } from '../src/stardict/stardict-reader.js';

const source = process.env.MEIKYO_DICTIONARY_DIR;
describe.skipIf(!source)('Meikyo canonical projection corpus regression', () => {
  it('projects every source record without persistence or silent loss', async () => {
    const summary = await auditMeikyoCanonicalProjection(source!);
    expect(summary.totalRecords).toBe(209_052); expect(summary.normalEntries).toBe(165_957);
    expect(summary.customLinksDeferred).toBe(43_095); expect(summary.projectionFailures).toBe(0);
    expect(summary.validationFailures).toBe(0); expect(summary.silentlyDroppedRecords).toBe(0);
    expect(summary.droppedAstNodes).toBe(0); expect(summary.astNodesFullyAccounted).toBe(summary.astNodes);
    expect(summary.sensesProduced).toBe(0); expect(summary.senseDefinitionsProduced).toBe(0);
    expect(summary.unresolvedDerivativeCases).toBe(3_782);
    expect(summary).toMatchObject({
      entriesProducingForms: 165_957, formsProduced: 206_120, entryDefinitionsProduced: 445_367,
      examplesProjected: 170_846, entryScopedExamples: 170_846, senseScopedExamples: 0,
      examplesRichContentOnly: 32_903, ambiguousDefinitionAlignments: 10_753,
      ambiguousExampleOwnership: 32_903, numberingRestartCases: 1_339,
      astNodes: 684_224, rawFallbackSourceNodes: 7_021,
      contentBlocksByKind: { definition: 233_554, example: 203_749, annotation: 185_667, section: 12_817, subdivision: 1_413, raw: 7_895 },
      exampleTextsByLanguage: { ja: 170_846, 'zh-CN': 170_846 },
    });

    const reader = await StarDictReader.open(source!); const parser = new MeikyoParser();
    const required = new Set(['一生懸命', '曖昧', '食べる', 'せっかく', 'おぼえる', '覚える', '謂ウ', '&c']);
    const projected = new Map(Array.from(reader.records()).filter((record) => required.has(record.headword))
      .map((record) => [record.headword, projectMeikyoEntry(parser.parse(record))]));
    expect(Array.from(projected.keys()).sort()).toEqual(Array.from(required).sort());
    for (const name of ['一生懸命', '曖昧', '食べる', 'せっかく', 'おぼえる', '覚える', '謂ウ']) {
      const entry = projected.get(name)!; expect(entry.kind).toBe('entry');
      if (entry.kind === 'entry') { expect(entry.senses).toHaveLength(0); expect(entry.entryDefinitions.length).toBeGreaterThan(0); }
    }
    expect(projected.get('一生懸命')).toMatchObject({ kind: 'entry', forms: [{ text: '一生懸命' }, { text: 'いっしょうけんめい' }] });
    expect(projected.get('&c')).toMatchObject({ kind: 'deferred-custom-link' });
    expect(projected.get('謂ウ')).toMatchObject({ kind: 'entry', contentBlocks: expect.arrayContaining([expect.objectContaining({ kind: 'subdivision' })]) });
  }, 120_000);
});

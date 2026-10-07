import { describe, expect, it } from 'vitest';
import { validateMeikyoProjection } from '../src/meikyo/canonical-projection-validator.js';
import type { EntryProjection } from '../src/meikyo/canonical-projection-types.js';
import { projectMeikyoEntry } from '../src/meikyo/meikyo-canonical-projector.js';
import { MeikyoParser } from '../src/meikyo/meikyo-parser.js';
import type { StarDictRecord } from '../src/stardict/stardict-reader.js';

const parser = new MeikyoParser();
const record = (headword: string, text: string, ordinal = 0): StarDictRecord => ({ ordinal, headword, offset: 17n, size: Buffer.byteLength(text), text });
function project(headword: string, text: string): { ast: ReturnType<MeikyoParser['parse']>; projection: EntryProjection } {
  const ast = parser.parse(record(headword, text)); const result = projectMeikyoEntry(ast);
  expect(result.kind).toBe('entry'); if (result.kind !== 'entry') throw new Error('expected entry projection');
  expect(validateMeikyoProjection(ast, result)).toEqual({ valid: true, issues: [] });
  return { ast, projection: result };
}

describe('MeikyoCanonicalProjector', () => {
  it('projects 一生懸命 conservatively with entry definitions and an entry-scoped bilingual example', () => {
    const { projection } = project('一生懸命', 'いっしょう‐けんめい［一生懸命］\n【形動・副】\n◯全力を尽くして物事をするさま。/拼命。\n｢~働く/拼命地工作｣');
    expect(projection.forms.map((form) => [form.text, form.kind])).toEqual([['一生懸命', 'kanji'], ['いっしょうけんめい', 'kana']]);
    expect(projection.senses).toEqual([]);
    expect(projection.entryDefinitions.map((item) => [item.language, item.text])).toEqual([['ja', '全力を尽くして物事をするさま。'], ['zh-CN', '拼命。']]);
    expect(projection.examples[0]).toMatchObject({ owner: { type: 'entry' }, texts: [{ language: 'ja', role: 'source' }, { language: 'zh-CN', role: 'translation' }] });
    const definitionBlock = projection.contentBlocks.find((block) => block.kind === 'definition')!;
    expect(projection.contentBlocks.find((block) => block.kind === 'example')?.parentRef).toBe(definitionBlock.ref);
  });

  it.each([
    ['曖昧', 'あいまい［曖昧］\n【形動】\n◯物事がはっきりしないさま。/暧昧。'],
    ['食べる', '【他下一】\n①固形の食物をかんで飲み込む。/吃。\n｢毎朝七時に朝ごはんを~/每天早上7点吃早饭｣\n②生活する。/生活。'],
    ['せっかく', '【名・副】\n◯大きな価値をもつ。/特意。\n◈語源中国の故事に基づく。'],
    ['覚える', '【他下一】\n①記憶にとどめる。/记住。\n②学んで身につける。/学会。'],
    ['おぼえる', '【他下一】\n①記憶にとどめる。/记住。'],
  ])('keeps source-numbered representative %s definitions entry-owned rather than inventing senses', (headword, text) => {
    const { projection } = project(headword, text);
    expect(projection.senses).toHaveLength(0); expect(projection.senseDefinitions).toHaveLength(0);
    expect(projection.entryDefinitions.length).toBeGreaterThan(0);
  });

  it('preserves mixed and restarted numbering without merging semantic groups', () => {
    const { projection } = project('mixed', '【動カ変】\n①第一。/第一。\n②第二。/第二。\n◯別ブロック。/另一个。\n①再開。/重新开始。');
    expect(projection.senses).toEqual([]);
    expect(projection.sourceArtifact.rawPayload).toContain('◯別ブロック');
    expect(projection.diagnostics.some((item) => item.code === 'numbering-restart')).toBe(true);
  });

  it('preserves nested subdivision structure under the active section', () => {
    const { projection } = project('nested', '【名】\n◈表現まとめ\n⑴第一。/第一。\n⑵第二。/第二。');
    const section = projection.contentBlocks.find((block) => block.kind === 'section')!;
    const subdivisions = projection.contentBlocks.filter((block) => block.kind === 'subdivision');
    expect(subdivisions).toHaveLength(2); expect(subdivisions.every((block) => block.parentRef === section.ref)).toBe(true);
  });

  it('maps ▶ and every audited special section to source-neutral annotation kinds', () => {
    const text = '【名】\n▶一般注記\n◈表記表記注記\n◈語法語法注記\n◈表現表現注記\n◈注意注意注記\n◈語源語源注記\n◈未分類\n表現独立表現\n派生派生語';
    const { projection } = project('sections', text);
    expect(projection.contentBlocks.map((block) => block.annotationKind).filter(Boolean)).toEqual([
      'grammar', 'note', 'orthography', 'grammar', 'expression', 'caution', 'etymology', 'other', 'expression', 'derivative',
    ]);
    expect(projection.diagnostics).toContainEqual(expect.objectContaining({ code: 'unresolved-derivative' }));
    expect(projection.forms).toHaveLength(1);
  });

  it('keeps ambiguous slash alignment and raw fallback as language-neutral rich content', () => {
    const { projection } = project('ace', '【名】\n①一秒間のサイクル数。/每秒周期数。1/100秒。\n｢閉じていない/没有关闭\nunknown payload');
    expect(projection.entryDefinitions).toHaveLength(0); expect(projection.examples).toHaveLength(0);
    expect(projection.contentBlocks.filter((block) => block.kind === 'raw')).toHaveLength(1);
    expect(projection.contentBlocks.find((block) => block.kind === 'definition')?.texts[0]).toMatchObject({ language: null });
    expect(projection.accounting).toHaveLength(4);
  });

  it('defers custom links and preserves all source-only fields in the private artifact', () => {
    const text = 'etching @@@LINK=░エッチング░【etching】🗏0331№5379⚠️补';
    const ast = parser.parse(record('&c', text)); const projection = projectMeikyoEntry(ast);
    expect(projection).toMatchObject({ kind: 'deferred-custom-link', indexHeadword: '&c', sourceArtifact: {
      rawPayload: text, sourceMetadata: { recordKind: 'custom-link', customLink: { target: 'etching', pageRaw: '0331', sourceIdRaw: '5379' } },
    } });
    expect(validateMeikyoProjection(ast, projection)).toEqual({ valid: true, issues: [] });
  });

  it('accounts for every AST node and validator detects deliberate accounting loss', () => {
    const { ast, projection } = project('謂ウ', `【動五】\n${Array.from('①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳', (marker, index) => `${marker}定義${index + 1}。/定义${index + 1}。`).join('\n')}\n◈表記⑴長い項目の注記。`);
    expect(projection.accounting).toHaveLength(ast.kind === 'entry' ? ast.nodes.length : 0);
    const damaged = { ...projection, accounting: projection.accounting.slice(1) };
    expect(validateMeikyoProjection(ast, damaged).issues.some((item) => item.code === 'dropped-ast-node')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { MeikyoParser, serializeMeikyoEntry } from '../src/meikyo/meikyo-parser.js';
import type { StarDictRecord } from '../src/stardict/stardict-reader.js';

const parser = new MeikyoParser();
const record = (headword: string, text: string, ordinal = 0): StarDictRecord => ({
  ordinal, headword, offset: 0n, size: Buffer.byteLength(text), text,
});

function parse(headword: string, text: string) {
  const result = parser.parse(record(headword, text));
  expect(serializeMeikyoEntry(result)).toBe(text);
  expect(result.payloadRaw).toBe(text);
  return result;
}

describe('MeikyoParser', () => {
  it('preserves explicit readings, forms, labels, definitions, examples, notes, and derivatives', () => {
    const text = 'いっしょう‐けんめい［一生懸命］\n【形動・副】\n◯全力を尽くして物事をするさま。/拼命。\n｢~働く/拼命地工作｣\n▶「一所懸命」から出た語。\n派生‐さ';
    const entry = parse('一生懸命', text);
    expect(entry.kind).toBe('entry');
    if (entry.kind !== 'entry') return;
    expect(entry.nodes.map((node) => node.type)).toEqual(['heading', 'grammatical-label', 'definition', 'example', 'note', 'derivative']);
    expect(entry.nodes[0]).toMatchObject({ readingRaw: 'いっしょう‐けんめい', normalizedReading: 'いっしょうけんめい', formsRaw: ['一生懸命'] });
    expect(entry.nodes[2]).toMatchObject({ marker: '◯', japaneseText: '全力を尽くして物事をするさま。', chineseText: '拼命。', alignment: 'paired' });
  });

  it.each([
    ['食べる', '【他下一】\n①固形の食物をかんで飲み込む。/吃。\n｢毎朝七時に朝ごはんを~/每天早上7点吃早饭｣\n表現⑴「食う」の丁寧語。\n②生活する。/生活。', ['grammatical-label', 'definition', 'example', 'expression', 'definition']],
    ['曖昧', 'あいまい［曖昧］\n【形動】\n◯物事がはっきりしないさま。/暧昧。\n◯表向きとは違う。/表里不一。\n▶他の語と複合して使う。', ['heading', 'grammatical-label', 'definition', 'definition', 'note']],
    ['せっかく', '【名・副】\n◯大きな価値をもつ。/特意。\n◈語源中国の故事に基づく。', ['grammatical-label', 'definition', 'special-section']],
    ['覚える', '【他下一】\n①記憶にとどめる。/记住。\n②学んで身につける。/学会。\n◈語源「おもほゆ🡺おぼえる」と転じた。', ['grammatical-label', 'definition', 'definition', 'special-section']],
    ['おぼえる', '【他下一】\n①記憶にとどめる。/记住。', ['grammatical-label', 'definition']],
  ])('parses audited representative entry %s', (headword, text, types) => {
    const entry = parse(headword, text);
    expect(entry.kind === 'entry' ? entry.nodes.map((node) => node.type) : []).toEqual(types);
  });

  it('preserves mixed, restarted, and nested numbering without inventing senses', () => {
    const text = '【動カ変】\n①第一。/第一。\n②第二。/第二。\n◯別ブロック。/另一个。\n①再開。/重新开始。\n㋐補助。/补充。';
    const entry = parse('mixed', text);
    if (entry.kind !== 'entry') throw new Error('expected lexical entry');
    expect(entry.nodes.filter((node) => node.type === 'definition').map((node) => node.marker)).toEqual(['①', '②', '◯', '①']);
    expect(entry.nodes.at(-1)).toMatchObject({ type: 'subdivision', system: 'circled-katakana', marker: '㋐', japaneseText: '補助。', chineseText: '补充。' });
  });

  it.each([
    ['表記', 'orthography'], ['語法', 'grammar'], ['表現', 'expression'], ['注意', 'caution'], ['語源', 'etymology'],
  ])('recognizes the ◈%s category while retaining its payload', (label, body) => {
    const entry = parse(label, `【名】\n◈${label}${body}`);
    if (entry.kind !== 'entry') throw new Error('expected lexical entry');
    expect(entry.nodes[1]).toMatchObject({ type: 'special-section', label, bodyRaw: body });
  });

  it('preserves unlabeled ◈ sections and unusual annotated headings/POS', () => {
    const entry = parse('一人天下', 'ひとり‐てんか［⟪一人⟫天下・独り天下］\n【名・形動トタル】\n◯説明。/说明。\n◈原義は高いの意。');
    if (entry.kind !== 'entry') throw new Error('expected lexical entry');
    expect(entry.nodes[0]).toMatchObject({ formsRaw: ['⟪一人⟫天下', '独り天下'] });
    expect(entry.nodes.at(-1)).toMatchObject({ type: 'special-section', label: null, bodyRaw: '原義は高いの意。' });
  });

  it('represents custom links separately without assigning redirect semantics', () => {
    const text = 'etching @@@LINK=░エッチング░【etching】🗏0331№5379⚠️补';
    expect(parse('&c', text)).toEqual(expect.objectContaining({
      kind: 'custom-link', indexHeadword: '&c', target: 'etching', display: 'エッチング', sourceRaw: 'etching',
      pageRaw: '0331', sourceIdRaw: '5379', warningRaw: '⚠️补', payloadRaw: text,
    }));
  });

  it('retains ambiguous slashes, malformed examples, and unknown lines without content loss', () => {
    const text = '【名】\n①一秒間のサイクル数。c/sで表す。/每秒周期数。1/100秒。\n｢閉じていない/没有关闭\nunknown payload';
    const entry = parse('ace', text);
    if (entry.kind !== 'entry') throw new Error('expected lexical entry');
    expect(entry.nodes[1]).toMatchObject({ type: 'definition', alignment: 'ambiguous', japaneseText: null, chineseText: null });
    expect(entry.nodes[2]).toMatchObject({ type: 'example', alignment: 'ambiguous' });
    expect(entry.nodes[3]).toMatchObject({ type: 'raw' });
    expect(entry.diagnostics.map((item) => item.code)).toEqual(['ambiguous-example', 'raw-line']);
  });

  it('handles a long entry with twenty markers and retains every byte', () => {
    const definitions = Array.from('①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳', (marker, index) => `${marker}定義${index + 1}。/定义${index + 1}。`).join('\n');
    const text = `【動五】\n${definitions}\n◈表記⑴長い項目の注記。`;
    const entry = parse('謂ウ', text);
    if (entry.kind !== 'entry') throw new Error('expected lexical entry');
    expect(entry.nodes.filter((node) => node.type === 'definition')).toHaveLength(20);
    expect(entry.nodes.at(-1)).toMatchObject({ type: 'special-section', label: '表記', nestedMarkers: [expect.objectContaining({ marker: '⑴' })] });
  });
});

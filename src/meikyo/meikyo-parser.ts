import type { StarDictRecord } from '../stardict/stardict-reader.js';
import type {
  DefinitionNode, ExampleNode, HeadingNode, MeikyoCustomLinkEntry, MeikyoDiagnostic, MeikyoDiamondLabel,
  MeikyoEntry, MeikyoLexicalEntry, MeikyoLineEnding, MeikyoNestedMarker, MeikyoNode, MeikyoPrimaryMarker,
} from './types.js';

const PRIMARY_MARKERS = new Set(Array.from('◯①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'));
const DIAMOND_LABELS = ['表記', '語法', '表現', '注意', '語源'] as const;
const CUSTOM_LINK = /^(.*?) @@@LINK=░(.*?)░【(.*?)】🗏(\d+)№(\d+)(⚠️.*)?$/su;
const GRAMMATICAL_LABEL = /^【([^】]*)】$/u;
const REDIRECT = /^→\s*(.*)$/u;
const EXPLICIT_HEADING = /^(.*?)［(.*)］$/u;
const LEADING_SUBDIVISION = /^(?<marker>[㋐-㋾⑴-⒇]|\(\d{1,2}\)|\[\d{1,2}\])(?<body>.*)$/u;
const KANA = /[ぁ-ヿー]/u;
const HAN = /[㐀-鿿]/u;

export class MeikyoParser {
  parse(record: StarDictRecord): MeikyoEntry {
    const identity = { ordinal: record.ordinal, indexHeadword: record.headword, offset: record.offset, size: record.size, payloadRaw: record.text };
    const link = CUSTOM_LINK.exec(record.text);
    if (link) return this.customLink(identity, link);

    const diagnostics: MeikyoDiagnostic[] = [];
    const lines = splitSourceLines(record.text);
    const nodes: MeikyoNode[] = lines.map((source, index) => this.parseLine(source, index, diagnostics));
    return { ...identity, kind: 'entry', nodes, diagnostics };
  }

  private customLink(identity: Omit<MeikyoCustomLinkEntry, 'kind' | 'target' | 'display' | 'sourceRaw' | 'pageRaw' | 'sourceIdRaw' | 'warningRaw' | 'diagnostics'>, match: RegExpExecArray): MeikyoCustomLinkEntry {
    return { ...identity, kind: 'custom-link', target: match[1], display: match[2], sourceRaw: match[3], pageRaw: match[4], sourceIdRaw: match[5], warningRaw: match[6] ?? null, diagnostics: [] };
  }

  private parseLine(source: SourceLine, index: number, diagnostics: MeikyoDiagnostic[]): MeikyoNode {
    const span = { line: index + 1, raw: source.raw, lineEnding: source.lineEnding };
    if (!source.raw) return { ...span, type: 'raw', reason: 'blank-line' };
    const label = GRAMMATICAL_LABEL.exec(source.raw);
    if (label) return { ...span, type: 'grammatical-label', value: label[1] };
    const first = Array.from(source.raw)[0];
    if (PRIMARY_MARKERS.has(first)) return this.definition(span, first as MeikyoPrimaryMarker, source.raw.slice(first.length));
    if (source.raw.startsWith('｢')) return this.example(span, diagnostics);
    if (source.raw.startsWith('▶')) return { ...span, type: 'note', marker: '▶', bodyRaw: source.raw.slice(1), nestedMarkers: findNestedMarkers(source.raw.slice(1)) };
    if (source.raw.startsWith('◈')) {
      const content = source.raw.slice(1);
      const labelValue = DIAMOND_LABELS.find((candidate) => content.startsWith(candidate)) ?? null;
      return { ...span, type: 'special-section', marker: '◈', label: labelValue, bodyRaw: content.slice(labelValue?.length ?? 0), nestedMarkers: findNestedMarkers(content) };
    }
    if (source.raw.startsWith('表現')) return { ...span, type: 'expression', marker: '表現', bodyRaw: source.raw.slice(2), nestedMarkers: findNestedMarkers(source.raw.slice(2)) };
    if (source.raw.startsWith('派生')) return { ...span, type: 'derivative', marker: '派生', bodyRaw: source.raw.slice(2), nestedMarkers: findNestedMarkers(source.raw.slice(2)) };
    const subdivision = LEADING_SUBDIVISION.exec(source.raw);
    if (subdivision?.groups) {
      const marker = subdivision.groups.marker;
      const bodyRaw = subdivision.groups.body;
      const system = marker.startsWith('㋐') || /^[㋐-㋾]$/u.test(marker) ? 'circled-katakana'
        : /^[⑴-⒇]$/u.test(marker) ? 'parenthesized-number'
          : marker.startsWith('(') ? 'ascii-parenthesized-number' : 'square-number';
      return { ...span, type: 'subdivision', system, marker, bodyRaw, ...alignLanguages(bodyRaw), nestedMarkers: findNestedMarkers(bodyRaw) };
    }
    const redirect = REDIRECT.exec(source.raw);
    if (redirect) return { ...span, type: 'redirect', targetRaw: redirect[1] };
    if (index === 0) return this.heading(span);
    diagnostics.push({ code: 'raw-line', message: 'Unrecognized source line was preserved verbatim', line: index + 1 });
    return { ...span, type: 'raw', reason: 'unknown-structure' };
  }

  private heading(span: SourceLine & { line: number }): HeadingNode {
    const explicit = EXPLICIT_HEADING.exec(span.raw);
    if (!explicit) return { ...span, type: 'heading', readingRaw: null, normalizedReading: null, orthographyRaw: null, formsRaw: [] };
    return {
      ...span, type: 'heading', readingRaw: explicit[1], normalizedReading: explicit[1].replace(/[‐―-]/gu, ''),
      orthographyRaw: explicit[2], formsRaw: splitOrthographies(explicit[2]),
    };
  }

  private definition(span: SourceLine & { line: number }, marker: MeikyoPrimaryMarker, bodyRaw: string): DefinitionNode {
    const aligned = alignLanguages(bodyRaw);
    return { ...span, type: 'definition', marker, bodyRaw, ...aligned, nestedMarkers: findNestedMarkers(bodyRaw) };
  }

  private example(span: SourceLine & { line: number }, diagnostics: MeikyoDiagnostic[]): ExampleNode {
    const closed = span.raw.endsWith('｣');
    const bodyRaw = span.raw.slice(1, closed ? -1 : undefined);
    const aligned = alignLanguages(bodyRaw);
    if (!closed || aligned.alignment !== 'paired') diagnostics.push({ code: 'ambiguous-example', message: 'Example delimiter or bilingual boundary is ambiguous; raw text was preserved', line: span.line });
    return { ...span, type: 'example', bodyRaw, japaneseText: aligned.japaneseText, chineseText: aligned.chineseText, alignment: closed && aligned.alignment === 'paired' ? 'paired' : 'ambiguous', nestedMarkers: findNestedMarkers(bodyRaw) };
  }
}

interface SourceLine { raw: string; lineEnding: MeikyoLineEnding }

export function serializeMeikyoEntry(entry: MeikyoEntry): string {
  if (entry.kind === 'custom-link') return entry.payloadRaw;
  return entry.nodes.map((node) => node.raw + node.lineEnding).join('');
}

function splitSourceLines(text: string): SourceLine[] {
  if (!text) return [];
  const lines: SourceLine[] = [];
  const matcher = /([^\r\n]*)(\r\n|\r|\n|$)/gu;
  for (const match of text.matchAll(matcher)) {
    if (match[0] === '') break;
    lines.push({ raw: match[1], lineEnding: match[2] as MeikyoLineEnding });
  }
  return lines;
}

function alignLanguages(body: string): Pick<DefinitionNode, 'japaneseText' | 'chineseText' | 'alignment'> {
  const first = body.indexOf('/');
  if (first < 0 || first !== body.lastIndexOf('/')) return { japaneseText: null, chineseText: null, alignment: 'ambiguous' };
  const japaneseText = body.slice(0, first);
  const chineseText = body.slice(first + 1);
  if (!japaneseText) return { japaneseText: null, chineseText, alignment: 'right-only' };
  if (!chineseText) return { japaneseText, chineseText: null, alignment: 'left-only' };
  const confidence = KANA.test(japaneseText) && !KANA.test(chineseText) && HAN.test(chineseText) ? 'paired' : 'ambiguous';
  return { japaneseText, chineseText, alignment: confidence };
}

function findNestedMarkers(body: string): MeikyoNestedMarker[] {
  const patterns: Array<[MeikyoNestedMarker['system'], RegExp]> = [
    ['circled-katakana', /[㋐-㋾]/gu], ['parenthesized-number', /[⑴-⒇]/gu],
    ['ascii-parenthesized-number', /\(\d{1,2}\)/gu], ['square-number', /\[\d{1,2}\]/gu],
  ];
  return patterns.flatMap(([system, regex]) => Array.from(body.matchAll(regex), (match) => ({ system, marker: match[0], offset: match.index })))
    .sort((a, b) => a.offset - b.offset);
}

function splitOrthographies(value: string): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '⟪' || character === '⟨') depth += 1;
    else if (character === '⟫' || character === '⟩') depth = Math.max(0, depth - 1);
    else if (character === '・' && depth === 0) { result.push(value.slice(start, index)); start = index + 1; }
  }
  result.push(value.slice(start));
  return result;
}

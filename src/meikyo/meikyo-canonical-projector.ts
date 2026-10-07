import crypto from 'node:crypto';
import type { MeikyoEntry, MeikyoLexicalEntry, MeikyoNode } from './types.js';
import type {
  AccountingDestination, CanonicalContentBlockProjection, CanonicalContentTextProjection,
  CanonicalDefinitionProjection, CanonicalExampleProjection, CanonicalFormProjection,
  CanonicalProjectionResult, EntryProjection, NodeAccounting, ProjectionAnnotationKind,
  ProjectionProvenance, SourceArtifactProjection,
} from './canonical-projection-types.js';

const KANA_ONLY = /^[ぁ-ヿー]+$/u;
const HAN = /[㐀-鿿]/u;
const NUMBERED = Array.from('①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳');
const SPECIAL_KINDS: Record<string, ProjectionAnnotationKind> = {
  表記: 'orthography', 語法: 'grammar', 表現: 'expression', 注意: 'caution', 語源: 'etymology',
};

export function projectMeikyoEntry(entry: MeikyoEntry): CanonicalProjectionResult {
  const artifact = sourceArtifact(entry);
  if (entry.kind === 'custom-link') return {
    kind: 'deferred-custom-link', sourceOrdinal: entry.ordinal, indexHeadword: entry.indexHeadword,
    sourceArtifact: artifact, diagnostics: [...entry.diagnostics], accounting: { record: ['source-artifact', 'deferred'] },
  };
  return projectLexical(entry, artifact);
}

function projectLexical(entry: MeikyoLexicalEntry, artifact: SourceArtifactProjection): EntryProjection {
  const forms: CanonicalFormProjection[] = [];
  const definitions: CanonicalDefinitionProjection[] = [];
  const examples: CanonicalExampleProjection[] = [];
  const blocks: CanonicalContentBlockProjection[] = [];
  const accounting: NodeAccounting[] = [];
  const diagnostics = [...entry.diagnostics];
  const seenForms = new Set<string>();
  const definitionOrdinals = new Map<string, number>();
  let exampleOrdinal = 0;
  let activeContainer: string | null = null;
  let lastNumber = 0;
  let sawNumbered = false;

  const addForm = (text: string, nodeIndex: number, line: number, kind: 'kanji' | 'kana' | null) => {
    const normalizedText = text.replace(/[‐―-]/gu, '');
    if (!text || seenForms.has(normalizedText)) return;
    seenForms.add(normalizedText);
    forms.push({ ref: `form-${forms.length}`, text, normalizedText, language: 'ja', kind, ordinal: forms.length,
      provenance: provenance(nodeIndex, line, 'heading') });
  };
  // The StarDict key is retained as entry identity and as a searchable surface, without treating it as a parsed reading.
  addForm(entry.indexHeadword, -1, 0, inferFormKind(entry.indexHeadword));

  entry.nodes.forEach((node, nodeIndex) => {
    const destinations = new Set<AccountingDestination>(['source-artifact']);
    const p: ProjectionProvenance = {
      ...provenance(nodeIndex, node.line, node.type),
      ...('marker' in node ? { marker: node.marker } : {}),
      ...(node.type === 'subdivision' ? { markerSystem: node.system } : {}),
    };
    if (node.type === 'heading') {
      if (node.normalizedReading && KANA_ONLY.test(node.normalizedReading)) addForm(node.normalizedReading, nodeIndex, node.line, 'kana');
      for (const form of node.formsRaw) {
        if (isSafeOrthography(form)) addForm(form, nodeIndex, node.line, inferFormKind(form));
        else diagnostics.push({ code: 'deferred-heading-form', message: `Annotated or ambiguous heading form was preserved only in the source artifact: ${form}`, line: node.line });
      }
      destinations.add('lexical'); activeContainer = null;
    } else if (node.type === 'definition') {
      const block = addBlock(blocks, node, nodeIndex, 'definition', null, null, definitionTexts(node, p));
      activeContainer = block.ref; destinations.add('rich-content');
      if (node.alignment !== 'ambiguous') {
        if (node.japaneseText !== null) addDefinition(definitions, node.japaneseText, 'ja', p, definitionOrdinals);
        if (node.chineseText !== null) addDefinition(definitions, node.chineseText, 'zh-CN', p, definitionOrdinals);
        destinations.add('lexical');
      } else diagnostics.push({ code: 'ambiguous-definition-alignment', message: 'Definition remains rich-content-only because language alignment is ambiguous', line: node.line });
      if (node.marker !== '◯') {
        const number = NUMBERED.indexOf(node.marker) + 1;
        if (sawNumbered && number <= lastNumber) diagnostics.push({ code: 'numbering-restart', message: `Numbered definition restarted or repeated at ${node.marker}; no canonical sense was inferred`, line: node.line });
        sawNumbered = true; lastNumber = number;
      }
    } else if (node.type === 'example') {
      const texts = node.alignment === 'paired' ? alignedTexts(node, p, 'source', 'translation') : rawText(node.bodyRaw, p);
      const block = addBlock(blocks, node, nodeIndex, 'example', null, activeContainer, texts);
      destinations.add('rich-content');
      if (node.alignment === 'paired' && node.japaneseText !== null && node.chineseText !== null) {
        examples.push({ ref: `example-${examples.length}`, owner: { type: 'entry' }, ordinal: exampleOrdinal++, contentBlockRef: block.ref,
          texts: alignedTexts(node, p, 'source', 'translation').map((text) => ({ ...text, language: text.language as 'ja' | 'zh-CN', role: text.role as 'source' | 'translation' })), provenance: p });
        destinations.add('lexical');
      } else diagnostics.push({ code: 'ambiguous-example-ownership-or-alignment', message: 'Example remains ordered rich content because its bilingual structure is ambiguous', line: node.line });
    } else if (node.type === 'grammatical-label') {
      addBlock(blocks, node, nodeIndex, 'annotation', 'grammar', null, [{ language: null, role: 'label', text: node.value, ordinal: 0, provenance: p }]);
      activeContainer = null; destinations.add('rich-content');
    } else if (node.type === 'note') {
      const block = addBlock(blocks, node, nodeIndex, 'annotation', 'note', null, rawText(node.bodyRaw, p));
      activeContainer = block.ref; destinations.add('rich-content');
    } else if (node.type === 'special-section') {
      const kind = node.label ? SPECIAL_KINDS[node.label] : 'other';
      const block = addBlock(blocks, node, nodeIndex, 'section', kind, null, rawText(node.bodyRaw, p));
      activeContainer = block.ref; destinations.add('rich-content');
    } else if (node.type === 'expression') {
      const block = addBlock(blocks, node, nodeIndex, 'section', 'expression', null, rawText(node.bodyRaw, p));
      activeContainer = block.ref; destinations.add('rich-content');
    } else if (node.type === 'derivative') {
      const block = addBlock(blocks, node, nodeIndex, 'section', 'derivative', null, rawText(node.bodyRaw, p));
      activeContainer = block.ref; destinations.add('rich-content'); destinations.add('deferred');
      diagnostics.push({ code: 'unresolved-derivative', message: 'Derivative text was preserved without creating a form or relation', line: node.line });
    } else if (node.type === 'subdivision') {
      addBlock(blocks, node, nodeIndex, 'subdivision', null, activeContainer, subdivisionTexts(node, p));
      destinations.add('rich-content');
      if (!activeContainer) diagnostics.push({ code: 'unscoped-subdivision', message: 'Subdivision has no deterministically active parent and remains entry-level', line: node.line });
    } else if (node.type === 'redirect') {
      addBlock(blocks, node, nodeIndex, 'raw', null, null, rawText(node.raw, p));
      activeContainer = null; destinations.add('rich-content'); destinations.add('deferred');
      diagnostics.push({ code: 'deferred-redirect', message: 'Plain redirect semantics require target validation and were not canonicalized', line: node.line });
    } else {
      addBlock(blocks, node, nodeIndex, 'raw', null, null, rawText(node.raw, p));
      activeContainer = null; destinations.add('rich-content');
    }
    accounting.push({ nodeIndex, line: node.line, sourceType: node.type, destinations: [...destinations] });
  });

  return { kind: 'entry', sourceOrdinal: entry.ordinal, headword: entry.indexHeadword, forms, senses: [],
    entryDefinitions: definitions, senseDefinitions: [], examples, contentBlocks: blocks,
    sourceArtifact: { ...artifact, diagnostics }, diagnostics, accounting };
}

function addDefinition(result: CanonicalDefinitionProjection[], text: string, language: 'ja' | 'zh-CN', p: ProjectionProvenance, ordinals: Map<string, number>) {
  const ordinal = ordinals.get(language) ?? 0; ordinals.set(language, ordinal + 1);
  result.push({ ref: `entry-definition-${result.length}`, owner: { type: 'entry' }, language, text, ordinal, provenance: p });
}

function addBlock(blocks: CanonicalContentBlockProjection[], node: MeikyoNode, nodeIndex: number,
  kind: CanonicalContentBlockProjection['kind'], annotationKind: ProjectionAnnotationKind | null,
  parentRef: string | null, texts: CanonicalContentTextProjection[]): CanonicalContentBlockProjection {
  const siblingOrdinal = blocks.filter((block) => block.parentRef === parentRef).length;
  const block: CanonicalContentBlockProjection = { ref: `block-${blocks.length}`, parentRef, senseRef: null, kind,
    annotationKind, ordinal: siblingOrdinal, texts, provenance: { ...provenance(nodeIndex, node.line, node.type),
      raw: node.raw, lineEnding: node.lineEnding, nestedMarkers: 'nestedMarkers' in node ? node.nestedMarkers : undefined } };
  blocks.push(block); return block;
}

function definitionTexts(node: Extract<MeikyoNode, { type: 'definition' }>, p: ProjectionProvenance): CanonicalContentTextProjection[] {
  return node.alignment === 'ambiguous' ? rawText(node.bodyRaw, p) : alignedTexts(node, p, 'definition', 'definition');
}
function subdivisionTexts(node: Extract<MeikyoNode, { type: 'subdivision' }>, p: ProjectionProvenance): CanonicalContentTextProjection[] {
  return node.alignment === 'ambiguous' ? rawText(node.bodyRaw, p) : alignedTexts(node, p, 'body', 'translation');
}
function alignedTexts(node: { japaneseText: string | null; chineseText: string | null }, p: ProjectionProvenance,
  jaRole: CanonicalContentTextProjection['role'], zhRole: CanonicalContentTextProjection['role']): CanonicalContentTextProjection[] {
  const result: CanonicalContentTextProjection[] = [];
  if (node.japaneseText !== null) result.push({ language: 'ja', role: jaRole, text: node.japaneseText, ordinal: result.length, provenance: p });
  if (node.chineseText !== null) result.push({ language: 'zh-CN', role: zhRole, text: node.chineseText, ordinal: result.length, provenance: p });
  return result;
}
function rawText(text: string, p: ProjectionProvenance): CanonicalContentTextProjection[] {
  return [{ language: null, role: 'body', text, ordinal: 0, provenance: p }];
}
function provenance(nodeIndex: number, line: number, sourceType: string): ProjectionProvenance { return { source: 'meikyo', nodeIndex, line, sourceType }; }
function inferFormKind(text: string): 'kanji' | 'kana' | null { return KANA_ONLY.test(text) ? 'kana' : HAN.test(text) ? 'kanji' : null; }
function isSafeOrthography(text: string): boolean { return Boolean(text) && !/[⟪⟫⟨⟩［］]/u.test(text); }

function sourceArtifact(entry: MeikyoEntry): SourceArtifactProjection {
  const parsedRepresentation = JSON.parse(JSON.stringify(entry, (_, value) => typeof value === 'bigint' ? value.toString() : value));
  const sourceMetadata: Record<string, unknown> = { byteOffset: entry.offset.toString(), byteSize: entry.size, recordKind: entry.kind };
  if (entry.kind === 'custom-link') Object.assign(sourceMetadata, { customLink: { target: entry.target, display: entry.display,
    sourceRaw: entry.sourceRaw, pageRaw: entry.pageRaw, sourceIdRaw: entry.sourceIdRaw, warningRaw: entry.warningRaw } });
  return { sourceFormat: 'stardict', parserName: 'MeikyoParser', parserVersion: '1', representationVersion: 1,
    sourceIdentity: { ordinal: entry.ordinal, indexHeadword: entry.indexHeadword }, rawPayload: entry.payloadRaw,
    parsedRepresentation, diagnostics: [...entry.diagnostics], sourceMetadata,
    contentChecksum: crypto.createHash('sha256').update(entry.payloadRaw).digest('hex') };
}

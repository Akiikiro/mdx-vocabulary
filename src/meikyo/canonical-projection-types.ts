import type { MeikyoDiagnostic, MeikyoEntry } from './types.js';

export type ProjectionLanguage = 'ja' | 'zh-CN';
export type ProjectionTextRole = 'source' | 'translation' | 'transliteration' | 'definition' | 'label' | 'body' | 'other';
export type ProjectionBlockKind = 'definition' | 'example' | 'annotation' | 'section' | 'subdivision' | 'raw';
export type ProjectionAnnotationKind = 'note' | 'grammar' | 'orthography' | 'usage' | 'caution' | 'expression' | 'etymology' | 'derivative' | 'other';

export interface ProjectionProvenance {
  source: 'meikyo';
  nodeIndex: number;
  line: number;
  sourceType: string;
  marker?: string;
  [key: string]: unknown;
}

export interface CanonicalFormProjection {
  ref: string; text: string; normalizedText: string; language: 'ja'; kind: 'kanji' | 'kana' | null;
  ordinal: number; provenance: ProjectionProvenance;
}
export interface CanonicalSenseProjection { ref: string; ordinal: number; provenance: ProjectionProvenance }
export interface CanonicalDefinitionProjection {
  ref: string; owner: { type: 'entry' } | { type: 'sense'; senseRef: string };
  language: ProjectionLanguage; text: string; ordinal: number; provenance: ProjectionProvenance;
}
export interface CanonicalExampleTextProjection {
  language: ProjectionLanguage; role: 'source' | 'translation'; text: string; ordinal: number; provenance: ProjectionProvenance;
}
export interface CanonicalExampleProjection {
  ref: string; owner: { type: 'entry' } | { type: 'sense'; senseRef: string }; ordinal: number;
  texts: CanonicalExampleTextProjection[]; contentBlockRef: string; provenance: ProjectionProvenance;
}
export interface CanonicalContentTextProjection {
  language: ProjectionLanguage | null; role: ProjectionTextRole; text: string; ordinal: number; provenance: ProjectionProvenance;
}
export interface CanonicalContentBlockProjection {
  ref: string; parentRef: string | null; senseRef: string | null; kind: ProjectionBlockKind;
  annotationKind: ProjectionAnnotationKind | null; ordinal: number; texts: CanonicalContentTextProjection[];
  provenance: ProjectionProvenance;
}
export interface SourceArtifactProjection {
  sourceFormat: 'stardict'; parserName: 'MeikyoParser'; parserVersion: '1'; representationVersion: 1;
  sourceIdentity: { ordinal: number; indexHeadword: string };
  rawPayload: string; parsedRepresentation: unknown; diagnostics: MeikyoDiagnostic[];
  sourceMetadata: Record<string, unknown>; contentChecksum: string;
}
export type AccountingDestination = 'lexical' | 'rich-content' | 'source-artifact' | 'deferred' | 'diagnostic';
export interface NodeAccounting { nodeIndex: number; line: number; sourceType: string; destinations: AccountingDestination[] }

export interface EntryProjection {
  kind: 'entry'; sourceOrdinal: number; headword: string;
  forms: CanonicalFormProjection[]; senses: CanonicalSenseProjection[];
  entryDefinitions: CanonicalDefinitionProjection[]; senseDefinitions: CanonicalDefinitionProjection[];
  examples: CanonicalExampleProjection[]; contentBlocks: CanonicalContentBlockProjection[];
  sourceArtifact: SourceArtifactProjection; diagnostics: MeikyoDiagnostic[]; accounting: NodeAccounting[];
}
export interface DeferredCustomLinkProjection {
  kind: 'deferred-custom-link'; sourceOrdinal: number; indexHeadword: string;
  sourceArtifact: SourceArtifactProjection; diagnostics: MeikyoDiagnostic[];
  accounting: { record: AccountingDestination[] };
}
export type CanonicalProjectionResult = EntryProjection | DeferredCustomLinkProjection;

export interface ProjectionValidationIssue { code: string; message: string; ref?: string }
export interface ProjectionValidationResult { valid: boolean; issues: ProjectionValidationIssue[] }

export function astNodeCount(entry: MeikyoEntry): number { return entry.kind === 'entry' ? entry.nodes.length : 0; }

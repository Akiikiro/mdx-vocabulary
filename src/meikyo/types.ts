export type MeikyoPrimaryMarker = '◯' | '①' | '②' | '③' | '④' | '⑤' | '⑥' | '⑦' | '⑧' | '⑨'
  | '⑩' | '⑪' | '⑫' | '⑬' | '⑭' | '⑮' | '⑯' | '⑰' | '⑱' | '⑲' | '⑳';
export type MeikyoDiamondLabel = '表記' | '語法' | '表現' | '注意' | '語源';
export type MeikyoLineEnding = '' | '\n' | '\r' | '\r\n';

export interface MeikyoSourceSpan { line: number; raw: string; lineEnding: MeikyoLineEnding }
export interface MeikyoNestedMarker { system: 'circled-katakana' | 'parenthesized-number' | 'ascii-parenthesized-number' | 'square-number'; marker: string; offset: number }
export interface MeikyoDiagnostic { code: string; message: string; line?: number }

export interface HeadingNode extends MeikyoSourceSpan {
  type: 'heading';
  readingRaw: string | null;
  normalizedReading: string | null;
  orthographyRaw: string | null;
  formsRaw: string[];
}
export interface GrammaticalLabelNode extends MeikyoSourceSpan { type: 'grammatical-label'; value: string }
export interface DefinitionNode extends MeikyoSourceSpan {
  type: 'definition'; marker: MeikyoPrimaryMarker; bodyRaw: string;
  japaneseText: string | null; chineseText: string | null;
  alignment: 'paired' | 'right-only' | 'left-only' | 'ambiguous';
  nestedMarkers: MeikyoNestedMarker[];
}
export interface ExampleNode extends MeikyoSourceSpan {
  type: 'example'; bodyRaw: string; japaneseText: string | null; chineseText: string | null;
  alignment: 'paired' | 'ambiguous'; nestedMarkers: MeikyoNestedMarker[];
}
export interface NoteNode extends MeikyoSourceSpan { type: 'note'; marker: '▶'; bodyRaw: string; nestedMarkers: MeikyoNestedMarker[] }
export interface SpecialSectionNode extends MeikyoSourceSpan { type: 'special-section'; marker: '◈'; label: MeikyoDiamondLabel | null; bodyRaw: string; nestedMarkers: MeikyoNestedMarker[] }
export interface ExpressionNode extends MeikyoSourceSpan { type: 'expression'; marker: '表現'; bodyRaw: string; nestedMarkers: MeikyoNestedMarker[] }
export interface DerivativeNode extends MeikyoSourceSpan { type: 'derivative'; marker: '派生'; bodyRaw: string; nestedMarkers: MeikyoNestedMarker[] }
export interface SubdivisionNode extends MeikyoSourceSpan {
  type: 'subdivision'; system: MeikyoNestedMarker['system']; marker: string; bodyRaw: string;
  japaneseText: string | null; chineseText: string | null; alignment: DefinitionNode['alignment']; nestedMarkers: MeikyoNestedMarker[];
}
export interface RedirectNode extends MeikyoSourceSpan { type: 'redirect'; targetRaw: string }
export interface RawNode extends MeikyoSourceSpan { type: 'raw'; reason: 'unknown-structure' | 'blank-line' }

export type MeikyoNode = HeadingNode | GrammaticalLabelNode | DefinitionNode | ExampleNode | NoteNode
  | SpecialSectionNode | ExpressionNode | DerivativeNode | SubdivisionNode | RedirectNode | RawNode;

export interface MeikyoEntryIdentity { ordinal: number; indexHeadword: string; offset: bigint; size: number; payloadRaw: string }
export interface MeikyoLexicalEntry extends MeikyoEntryIdentity {
  kind: 'entry'; nodes: MeikyoNode[]; diagnostics: MeikyoDiagnostic[];
}
export interface MeikyoCustomLinkEntry extends MeikyoEntryIdentity {
  kind: 'custom-link'; target: string; display: string; sourceRaw: string; pageRaw: string; sourceIdRaw: string;
  warningRaw: string | null; diagnostics: MeikyoDiagnostic[];
}
export type MeikyoEntry = MeikyoLexicalEntry | MeikyoCustomLinkEntry;

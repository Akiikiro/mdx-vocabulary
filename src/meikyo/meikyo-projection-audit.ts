import { performance } from 'node:perf_hooks';
import { StarDictReader } from '../stardict/stardict-reader.js';
import { validateMeikyoProjection } from './canonical-projection-validator.js';
import type { ProjectionBlockKind, ProjectionLanguage } from './canonical-projection-types.js';
import { projectMeikyoEntry } from './meikyo-canonical-projector.js';
import { MeikyoParser } from './meikyo-parser.js';

export interface MeikyoProjectionAuditSummary {
  totalRecords: number; normalEntries: number; customLinksDeferred: number;
  projectionFailures: number; validationFailures: number; silentlyDroppedRecords: number;
  entriesProducingForms: number; formsProduced: number; entriesProducingSenses: number; sensesProduced: number;
  entryDefinitionsProduced: number; senseDefinitionsProduced: number;
  examplesProjected: number; entryScopedExamples: number; senseScopedExamples: number; examplesRichContentOnly: number;
  exampleTextsByLanguage: Record<string, number>;
  contentBlocksByKind: Record<ProjectionBlockKind, number>; contentTextsByLanguage: Record<string, number>;
  nestedBlockCount: number; rawFallbackBlockCount: number;
  astNodes: number; astNodesFullyAccounted: number; droppedAstNodes: number;
  ambiguousDefinitionAlignments: number; ambiguousExampleOwnership: number; numberingRestartCases: number;
  unresolvedDerivativeCases: number; rawFallbackSourceNodes: number;
  durationMs: number; peakRssBytes: number;
  validationIssueCodes: Record<string, number>; projectionFailureSamples: string[];
}

export async function auditMeikyoCanonicalProjection(sourcePath: string): Promise<MeikyoProjectionAuditSummary> {
  const started = performance.now();
  const reader = await StarDictReader.open(sourcePath); const parser = new MeikyoParser();
  const summary: MeikyoProjectionAuditSummary = {
    totalRecords: reader.recordCount, normalEntries: 0, customLinksDeferred: 0, projectionFailures: 0,
    validationFailures: 0, silentlyDroppedRecords: 0, entriesProducingForms: 0, formsProduced: 0,
    entriesProducingSenses: 0, sensesProduced: 0, entryDefinitionsProduced: 0, senseDefinitionsProduced: 0,
    examplesProjected: 0, entryScopedExamples: 0, senseScopedExamples: 0, examplesRichContentOnly: 0,
    exampleTextsByLanguage: {}, contentBlocksByKind: emptyBlocks(), contentTextsByLanguage: {}, nestedBlockCount: 0,
    rawFallbackBlockCount: 0, astNodes: 0, astNodesFullyAccounted: 0, droppedAstNodes: 0,
    ambiguousDefinitionAlignments: 0, ambiguousExampleOwnership: 0, numberingRestartCases: 0,
    unresolvedDerivativeCases: 0, rawFallbackSourceNodes: 0, durationMs: 0, peakRssBytes: process.memoryUsage().rss,
    validationIssueCodes: {}, projectionFailureSamples: [],
  };
  for (const record of reader.records()) {
    try {
      const ast = parser.parse(record); const projection = projectMeikyoEntry(ast);
      const validation = validateMeikyoProjection(ast, projection);
      if (!validation.valid) {
        summary.validationFailures += 1;
        for (const issue of validation.issues) increment(summary.validationIssueCodes, issue.code);
      }
      if (ast.kind === 'custom-link') {
        if (projection.kind === 'deferred-custom-link') summary.customLinksDeferred += 1;
        else summary.silentlyDroppedRecords += 1;
      } else if (projection.kind === 'entry') {
        summary.normalEntries += 1; summary.astNodes += ast.nodes.length;
        summary.astNodesFullyAccounted += projection.accounting.filter((item) => item.destinations.length > 0).length;
        summary.droppedAstNodes += ast.nodes.length - projection.accounting.filter((item) => item.destinations.length > 0).length;
        if (projection.forms.length) summary.entriesProducingForms += 1; summary.formsProduced += projection.forms.length;
        if (projection.senses.length) summary.entriesProducingSenses += 1; summary.sensesProduced += projection.senses.length;
        summary.entryDefinitionsProduced += projection.entryDefinitions.length; summary.senseDefinitionsProduced += projection.senseDefinitions.length;
        summary.examplesProjected += projection.examples.length;
        summary.entryScopedExamples += projection.examples.filter((item) => item.owner.type === 'entry').length;
        summary.senseScopedExamples += projection.examples.filter((item) => item.owner.type === 'sense').length;
        for (const example of projection.examples) for (const text of example.texts) increment(summary.exampleTextsByLanguage, text.language);
        for (const block of projection.contentBlocks) {
          summary.contentBlocksByKind[block.kind] += 1; if (block.parentRef) summary.nestedBlockCount += 1;
          if (block.kind === 'raw') summary.rawFallbackBlockCount += 1;
          for (const text of block.texts) increment(summary.contentTextsByLanguage, text.language ?? 'und');
        }
        const codes = projection.diagnostics.map((item) => item.code);
        summary.ambiguousDefinitionAlignments += codes.filter((code) => code === 'ambiguous-definition-alignment').length;
        summary.ambiguousExampleOwnership += codes.filter((code) => code === 'ambiguous-example-ownership-or-alignment').length;
        summary.numberingRestartCases += codes.filter((code) => code === 'numbering-restart').length;
        summary.unresolvedDerivativeCases += codes.filter((code) => code === 'unresolved-derivative').length;
        const sourceExamples = ast.nodes.filter((node) => node.type === 'example').length;
        summary.examplesRichContentOnly += sourceExamples - projection.examples.length;
        summary.rawFallbackSourceNodes += ast.nodes.filter((node) => node.type === 'raw').length;
      } else summary.silentlyDroppedRecords += 1;
    } catch (error) {
      summary.projectionFailures += 1;
      if (summary.projectionFailureSamples.length < 10) summary.projectionFailureSamples.push(`${record.ordinal}:${record.headword}: ${error instanceof Error ? error.message : String(error)}`);
    }
    summary.peakRssBytes = Math.max(summary.peakRssBytes, process.memoryUsage().rss);
  }
  summary.durationMs = performance.now() - started; return summary;
}

function increment(target: Record<string, number>, key: string) { target[key] = (target[key] ?? 0) + 1; }
function emptyBlocks(): Record<ProjectionBlockKind, number> { return { definition: 0, example: 0, annotation: 0, section: 0, subdivision: 0, raw: 0 }; }

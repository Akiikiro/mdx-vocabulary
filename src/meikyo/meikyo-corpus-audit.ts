import { performance } from 'node:perf_hooks';
import { StarDictReader } from '../stardict/stardict-reader.js';
import { MeikyoParser, serializeMeikyoEntry } from './meikyo-parser.js';
import type { MeikyoNode } from './types.js';

export interface MeikyoCorpusParseSummary {
  records: number;
  normalEntries: number;
  customLinks: number;
  nodes: Record<MeikyoNode['type'], number>;
  rawFallbackNodes: number;
  rawFallbackReasons: { unknownStructure: number; blankLine: number };
  entriesWithRawFallback: number;
  entriesWithUnknownStructure: number;
  entriesWithBlankLines: number;
  parseFailures: number;
  contentLossFailures: number;
  durationMs: number;
  peakMemoryBytes: number;
}

export async function auditMeikyoCorpus(sourcePath: string): Promise<MeikyoCorpusParseSummary> {
  const started = performance.now();
  const reader = await StarDictReader.open(sourcePath);
  const parser = new MeikyoParser();
  const nodes = emptyNodeCounts();
  let normalEntries = 0;
  let customLinks = 0;
  let rawFallbackNodes = 0;
  let entriesWithRawFallback = 0;
  let entriesWithUnknownStructure = 0;
  let entriesWithBlankLines = 0;
  let unknownStructure = 0;
  let blankLine = 0;
  let parseFailures = 0;
  let contentLossFailures = 0;
  let peakMemoryBytes = process.memoryUsage().rss;

  for (const record of reader.records()) {
    try {
      const entry = parser.parse(record);
      if (entry.kind === 'custom-link') customLinks += 1;
      else {
        normalEntries += 1;
        let hasRaw = false;
        let hasUnknown = false;
        let hasBlank = false;
        for (const node of entry.nodes) {
          nodes[node.type] += 1;
          if (node.type === 'raw') {
            rawFallbackNodes += 1; hasRaw = true;
            if (node.reason === 'blank-line') { blankLine += 1; hasBlank = true; }
            else { unknownStructure += 1; hasUnknown = true; }
          }
        }
        if (hasRaw) entriesWithRawFallback += 1;
        if (hasUnknown) entriesWithUnknownStructure += 1;
        if (hasBlank) entriesWithBlankLines += 1;
      }
      if (serializeMeikyoEntry(entry) !== record.text) contentLossFailures += 1;
    } catch {
      parseFailures += 1;
    }
    peakMemoryBytes = Math.max(peakMemoryBytes, process.memoryUsage().rss);
  }
  return {
    records: reader.recordCount, normalEntries, customLinks, nodes, rawFallbackNodes,
    rawFallbackReasons: { unknownStructure, blankLine }, entriesWithRawFallback,
    entriesWithUnknownStructure, entriesWithBlankLines,
    parseFailures, contentLossFailures, durationMs: performance.now() - started, peakMemoryBytes,
  };
}

function emptyNodeCounts(): Record<MeikyoNode['type'], number> {
  return {
    heading: 0, 'grammatical-label': 0, definition: 0, example: 0, note: 0,
    'special-section': 0, expression: 0, derivative: 0, subdivision: 0, redirect: 0, raw: 0,
  };
}

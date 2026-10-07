import type { MeikyoEntry } from './types.js';
import type { CanonicalProjectionResult, EntryProjection, ProjectionValidationIssue, ProjectionValidationResult } from './canonical-projection-types.js';

const LANG = /^(?:[a-z]{2,3})(?:-[A-Z]{2})?$/u;

export function validateMeikyoProjection(source: MeikyoEntry, projection: CanonicalProjectionResult): ProjectionValidationResult {
  const issues: ProjectionValidationIssue[] = [];
  if (!projection.sourceArtifact || typeof projection.sourceArtifact.rawPayload !== 'string') issue(issues, 'missing-source-artifact', 'A lossless source artifact is required');
  else if (projection.sourceArtifact.rawPayload !== source.payloadRaw) issue(issues, 'artifact-payload-mismatch', 'Source artifact payload differs from the AST source payload');
  if (source.kind === 'custom-link') {
    if (projection.kind !== 'deferred-custom-link') issue(issues, 'custom-link-canonicalized', 'Custom link must remain deferred');
    return { valid: issues.length === 0, issues };
  }
  if (projection.kind !== 'entry') { issue(issues, 'entry-deferred', 'Lexical entry was unexpectedly deferred'); return { valid: false, issues }; }
  validateEntry(source, projection, issues);
  return { valid: issues.length === 0, issues };
}

function validateEntry(source: Extract<MeikyoEntry, { kind: 'entry' }>, p: EntryProjection, issues: ProjectionValidationIssue[]) {
  uniqueOrdinals(p.forms, 'form', issues); uniqueOrdinals(p.senses, 'sense', issues); uniqueOrdinals(p.examples, 'example', issues);
  const senseRefs = new Set(p.senses.map((sense) => sense.ref));
  for (const definition of [...p.entryDefinitions, ...p.senseDefinitions]) {
    if (definition.owner.type === 'sense' && !senseRefs.has(definition.owner.senseRef)) issue(issues, 'invalid-sense-reference', 'Definition refers to a non-local sense', definition.ref);
    if (!LANG.test(definition.language)) issue(issues, 'invalid-language', `Invalid definition language ${definition.language}`, definition.ref);
  }
  const blockRefs = new Set(p.contentBlocks.map((block) => block.ref));
  const usedExampleBlocks = new Set<string>();
  for (const example of p.examples) {
    if (example.owner.type === 'sense' && !senseRefs.has(example.owner.senseRef)) issue(issues, 'invalid-example-scope', 'Example refers to a non-local sense', example.ref);
    if (!blockRefs.has(example.contentBlockRef)) issue(issues, 'invalid-example-block', 'Example has no local content block', example.ref);
    else if (p.contentBlocks.find((block) => block.ref === example.contentBlockRef)?.kind !== 'example') issue(issues, 'invalid-example-block-kind', 'Example refers to a non-example content block', example.ref);
    if (usedExampleBlocks.has(example.contentBlockRef)) issue(issues, 'duplicate-example-block', 'More than one example refers to the same content block', example.ref);
    usedExampleBlocks.add(example.contentBlockRef);
    uniqueOrdinals(example.texts, `example text ${example.ref}`, issues);
    for (const text of example.texts) if (!LANG.test(text.language)) issue(issues, 'invalid-language', `Invalid example language ${text.language}`, example.ref);
  }
  for (const block of p.contentBlocks) {
    if (block.parentRef && (!blockRefs.has(block.parentRef) || block.parentRef === block.ref)) issue(issues, 'invalid-block-parent', 'Block parent is absent or self-referential', block.ref);
    if (block.senseRef && !senseRefs.has(block.senseRef)) issue(issues, 'invalid-sense-reference', 'Block refers to a non-local sense', block.ref);
    uniqueOrdinals(block.texts, `content text ${block.ref}`, issues);
    for (const text of block.texts) if (text.language !== null && !LANG.test(text.language)) issue(issues, 'invalid-language', `Invalid content language ${text.language}`, block.ref);
  }
  for (const parent of new Set(p.contentBlocks.map((block) => block.parentRef))) uniqueOrdinals(p.contentBlocks.filter((block) => block.parentRef === parent), `block siblings ${parent ?? 'root'}`, issues);
  for (const block of p.contentBlocks) {
    const visited = new Set<string>(); let cursor: typeof block | undefined = block;
    while (cursor?.parentRef) { if (visited.has(cursor.ref)) { issue(issues, 'block-cycle', 'Content block parent cycle detected', block.ref); break; } visited.add(cursor.ref); cursor = p.contentBlocks.find((candidate) => candidate.ref === cursor!.parentRef); }
  }
  const accounted = new Map(p.accounting.map((item) => [item.nodeIndex, item]));
  source.nodes.forEach((node, index) => {
    const item = accounted.get(index);
    if (!item || item.destinations.length === 0) issue(issues, 'dropped-ast-node', `AST node ${index} (${node.type}) is unaccounted`, String(index));
  });
  if (accounted.size !== source.nodes.length) issue(issues, 'accounting-cardinality', 'Accounting does not match AST node count');
}

function uniqueOrdinals(items: Array<{ ordinal: number }>, label: string, issues: ProjectionValidationIssue[]) {
  const values = new Set<number>();
  for (const item of items) {
    if (!Number.isSafeInteger(item.ordinal) || item.ordinal < 0) issue(issues, 'invalid-ordinal', `${label} ordinal is invalid`);
    if (values.has(item.ordinal)) issue(issues, 'duplicate-ordinal', `${label} ordinal ${item.ordinal} is duplicated`);
    values.add(item.ordinal);
  }
}
function issue(issues: ProjectionValidationIssue[], code: string, message: string, ref?: string) { issues.push({ code, message, ...(ref ? { ref } : {}) }); }

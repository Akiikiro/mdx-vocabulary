import { auditMeikyoCanonicalProjection } from '../meikyo/meikyo-projection-audit.js';

const source = process.argv[2];
if (!source) throw new Error('Usage: npm run audit-meikyo-projection -- <StarDict directory or base path>');
const summary = await auditMeikyoCanonicalProjection(source);
console.log(JSON.stringify(summary, null, 2));
if (summary.totalRecords !== 209_052 || summary.projectionFailures || summary.validationFailures || summary.silentlyDroppedRecords ||
    summary.droppedAstNodes || summary.customLinksDeferred !== 43_095) process.exitCode = 1;

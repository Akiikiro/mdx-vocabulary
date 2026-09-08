export class InvalidLogicalResourcePathError extends Error {}

/** Convert an API logical path to an exact MDD key without case or Unicode folding. */
export function normalizeLogicalResourcePath(logicalPath: string): string {
  if (!logicalPath || logicalPath.includes('\0') || /[\u0001-\u001f\u007f]/u.test(logicalPath)) {
    throw new InvalidLogicalResourcePathError('Invalid logical resource path');
  }
  if (logicalPath.startsWith('/') || logicalPath.startsWith('\\') || logicalPath.includes('\\') || /^[A-Za-z]:/u.test(logicalPath)) {
    throw new InvalidLogicalResourcePathError('Absolute paths and backslashes are not allowed');
  }
  const segments = logicalPath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new InvalidLogicalResourcePathError('Invalid logical resource path segment');
  }
  return `\\${segments.join('\\')}`;
}

import sanitizeHtml from 'sanitize-html';
import { MDICT_MARKER_ATTRIBUTES, transformMdictReferences } from './mdict-references.js';

const options: sanitizeHtml.IOptions = {
  allowedTags: ['a', 'b', 'br', 'div', 'em', 'i', 'li', 'ol', 'p', 'span', 'strong', 'sub', 'sup', 'u', 'ul'],
  allowedAttributes: {
    a: ['href', 'title'], span: ['class', ...MDICT_MARKER_ATTRIBUTES],
    div: ['class'], p: ['class'], '*': ['lang'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
};
export function sanitizeEntryHtml(rawEntry: string): string {
  return sanitizeHtml(transformMdictReferences(rawEntry), options);
}
export function entryPlainText(sanitizedHtml: string): string {
  const withBoundaries = sanitizedHtml.replace(/<\/?(?:br|p|div|li|tr|h[1-6])\b[^>]*>/gi, ' ');
  return sanitizeHtml(withBoundaries, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
}

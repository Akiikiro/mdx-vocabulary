import sanitizeHtml from 'sanitize-html';
import { normalizeLogicalResourcePath } from '../resources/logical-resource-path.js';

export const MDICT_MARKER_ATTRIBUTES = [
  'data-mdict-kind',
  'data-mdict-resource',
  'data-mdict-entry-target',
] as const;

const MAX_REFERENCE_LENGTH = 4096;
const markerAttributeSet = new Set<string>(MDICT_MARKER_ATTRIBUTES);

function decodedReference(value: string): string | null {
  if (!value || value.length > MAX_REFERENCE_LENGTH) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function logicalResourcePath(sourceReference: string, allowRootRelative: boolean): string | null {
  const decoded = decodedReference(sourceReference);
  if (decoded === null || decoded.startsWith('//')) return null;
  const candidate = allowRootRelative && decoded.startsWith('/') ? decoded.slice(1) : decoded;
  if (allowRootRelative && /^[A-Za-z][A-Za-z\d+.-]*:/u.test(candidate)) return null;
  try {
    normalizeLogicalResourcePath(candidate);
    return candidate;
  } catch {
    return null;
  }
}

function entryTarget(sourceReference: string): string | null {
  const decoded = decodedReference(sourceReference);
  if (decoded === null || !decoded.trim() || /[\u0000-\u001f\u007f]/u.test(decoded)) return null;
  return decoded;
}

function withoutMarkerAttributes(attribs: sanitizeHtml.Attributes): sanitizeHtml.Attributes {
  return Object.fromEntries(Object.entries(attribs).filter(([name]) => !markerAttributeSet.has(name)));
}

/**
 * Accepts raw, untrusted MDict HTML only. It recognizes internal references while
 * sanitizing the input, so raw data-mdict-* attributes cannot become trusted markers.
 */
export function transformMdictReferences(rawEntry: string): string {
  let soundDepth = 0;
  const soundElements: boolean[] = [];

  return sanitizeHtml(rawEntry, {
    allowedTags: ['a', 'b', 'br', 'div', 'em', 'i', 'li', 'ol', 'p', 'span', 'strong', 'sub', 'sup', 'u', 'ul'],
    allowedAttributes: {
      a: ['href', 'title'],
      span: ['class', ...MDICT_MARKER_ATTRIBUTES],
      div: ['class'], p: ['class'], '*': ['lang'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    onOpenTag: (name, attribs) => {
      const href = name === 'a' ? attribs.href : undefined;
      const isSound = href !== undefined && /^sound:\/\//iu.test(href)
        && logicalResourcePath(href.replace(/^sound:\/\//iu, ''), false) !== null;
      soundElements.push(isSound);
      if (isSound) soundDepth += 1;
    },
    onCloseTag: () => {
      if (soundElements.pop()) soundDepth -= 1;
    },
    transformTags: {
      span: (tagName, attribs) => ({ tagName, attribs: withoutMarkerAttributes(attribs) }),
      a: (tagName, attribs) => {
        const href = attribs.href;
        const soundMatch = href?.match(/^sound:\/\/(.*)$/iu);
        if (soundMatch) {
          const resource = logicalResourcePath(soundMatch[1], false);
          if (resource) {
            return {
              tagName: 'span', text: '',
              attribs: { 'data-mdict-kind': 'sound', 'data-mdict-resource': resource },
            };
          }
        }
        const entryMatch = href?.match(/^entry:\/\/(.*)$/iu);
        if (entryMatch) {
          const target = entryTarget(entryMatch[1]);
          if (target) {
            return {
              tagName: 'span',
              attribs: { 'data-mdict-kind': 'entry', 'data-mdict-entry-target': target },
            };
          }
        }
        const safeOrdinaryAttributes = { ...attribs };
        if (href && !/^(?:https?|mailto):/iu.test(href)) delete safeOrdinaryAttributes.href;
        return { tagName, attribs: safeOrdinaryAttributes };
      },
      img: (_tagName, attribs) => {
        if (soundDepth > 0) return { tagName: 'mdict-discard', attribs: {} as sanitizeHtml.Attributes, text: '' };
        const resource = attribs.src === undefined ? null : logicalResourcePath(attribs.src, true);
        if (!resource) return { tagName: 'mdict-discard', attribs: {} as sanitizeHtml.Attributes, text: '' };
        return {
          tagName: 'span', text: '',
          attribs: { 'data-mdict-kind': 'image', 'data-mdict-resource': resource },
        };
      },
    },
  });
}

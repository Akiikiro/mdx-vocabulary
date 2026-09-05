import { describe, expect, it } from 'vitest';
import { normalizeHeadword, parseRedirect } from '../src/entries/normalize.js';
import { entryPlainText, sanitizeEntryHtml } from '../src/entries/html.js';
import { canTransition } from '../src/jobs/state.js';

describe('entry utilities', () => {
  it('normalizes headwords deterministically', () => expect(normalizeHeadword('  Café   APPLE  ')).toBe('café apple'));
  it('detects MDX redirects and strips NUL terminators', () => expect(parseRedirect('@@@LINK=apple\r\n\0')).toBe('apple'));
  it('removes executable HTML while retaining safe learning content', () => {
    const clean = sanitizeEntryHtml('<span class="d" onclick="x()">apple</span><script>alert(1)</script><a href="javascript:x">bad</a>');
    expect(clean).toContain('apple'); expect(clean).not.toContain('script'); expect(clean).not.toContain('onclick');
  });
  it('extracts readable plain text', () => expect(entryPlainText('<span>apple</span><br><b>苹果</b>')).toBe('apple 苹果'));
  it('allows only valid job transitions', () => { expect(canTransition('queued', 'running')).toBe(true); expect(canTransition('queued', 'completed')).toBe(false); });
});

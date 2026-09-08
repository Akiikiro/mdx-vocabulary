import { describe, expect, it } from 'vitest';
import { detectResourceContentType } from '../src/resources/content-type.js';

describe('detectResourceContentType', () => {
  it.each([
    [Buffer.from('OggSdata'), 'audio/ogg'],
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    [Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg'],
    [Buffer.from('GIF89a'), 'image/gif'],
    [Buffer.from('unknown'), 'application/octet-stream'],
  ])('detects verified magic bytes', (bytes, expected) => expect(detectResourceContentType(bytes)).toBe(expected));
});

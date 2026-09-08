import { describe, expect, it, vi } from 'vitest';
import { JsMddResourceAdapter } from '../src/mdx/mdd-resource-adapter.js';

describe('JsMddResourceAdapter', () => {
  it('performs exact lookup and decodes the library Base64 value to bytes', () => {
    const locate = vi.fn((key: string) => ({
      definition: key === '\\Audio\\Test.OGG' ? Buffer.from([0x4f, 0x67, 0x67, 0x53]).toString('base64') : null,
    }));
    const close = vi.fn();
    const adapter = new JsMddResourceAdapter(2, () => ({ locate, close }));

    expect(adapter.lookupResource('/volume.mdd', '\\Audio\\Test.OGG')).toEqual(Buffer.from('OggS'));
    expect(adapter.lookupResource('/volume.mdd', '\\audio\\test.ogg')).toBeNull();
    expect(locate).toHaveBeenCalledWith('\\Audio\\Test.OGG');
    adapter.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it('reuses open volumes and closes the least recently used volume', () => {
    const closed: string[] = [];
    const adapter = new JsMddResourceAdapter(1, (mddPath) => ({
      locate: () => ({ definition: null }), close: () => closed.push(mddPath),
    }));
    adapter.lookupResource('/base.mdd', '\\x');
    adapter.lookupResource('/base.1.mdd', '\\x');
    expect(closed).toEqual(['/base.mdd']);
    adapter.close();
    expect(closed).toEqual(['/base.mdd', '/base.1.mdd']);
  });
});

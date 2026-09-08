import type { MdxEntryLocator } from './lazy-mdx-adapter.js';

export interface PersistedMdxLocatorFields {
  mdxLocatorVersion: number | null;
  mdxLocatorFileChecksum: string | null;
  mdxLocatorKeyText: string | null;
  mdxLocatorKeyBlockIndex: number | null;
  mdxLocatorRecordStartOffset: bigint | null;
  mdxLocatorRecordEndOffset: bigint | null;
}

export class PartialPersistedMdxLocatorError extends Error {}

export function persistedFieldsFromMdxLocator(locator: MdxEntryLocator): Required<PersistedMdxLocatorFields> {
  return {
    mdxLocatorVersion: locator.version,
    mdxLocatorFileChecksum: locator.fileChecksum,
    mdxLocatorKeyText: locator.keyText,
    mdxLocatorKeyBlockIndex: locator.keyBlockIndex,
    mdxLocatorRecordStartOffset: locator.recordStartOffset,
    mdxLocatorRecordEndOffset: locator.recordEndOffset,
  };
}

export function mdxLocatorFromPersistedFields(fields: PersistedMdxLocatorFields): MdxEntryLocator | null {
  const values = [fields.mdxLocatorVersion, fields.mdxLocatorFileChecksum, fields.mdxLocatorKeyText,
    fields.mdxLocatorKeyBlockIndex, fields.mdxLocatorRecordStartOffset, fields.mdxLocatorRecordEndOffset];
  if (values.every((value) => value === null)) return null;
  if (values.some((value) => value === null)) throw new PartialPersistedMdxLocatorError('Dictionary entry contains a partial MDX locator');
  if (fields.mdxLocatorVersion !== 1) throw new PartialPersistedMdxLocatorError('Dictionary entry contains an unsupported MDX locator version');
  return {
    version: 1,
    fileChecksum: fields.mdxLocatorFileChecksum!,
    keyText: fields.mdxLocatorKeyText!,
    keyBlockIndex: fields.mdxLocatorKeyBlockIndex!,
    recordStartOffset: fields.mdxLocatorRecordStartOffset!,
    recordEndOffset: fields.mdxLocatorRecordEndOffset!,
  };
}

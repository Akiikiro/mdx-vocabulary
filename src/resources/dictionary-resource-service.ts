import type { PrismaClient } from '@prisma/client';
import type { MddResourceAdapter } from '../mdx/mdd-resource-adapter.js';
import type { DictionaryPackageStorage } from '../storage/dictionary-package-storage.js';
import { detectResourceContentType } from './content-type.js';
import { normalizeLogicalResourcePath } from './logical-resource-path.js';

export interface DictionaryResource {
  bytes: Buffer;
  contentType: string;
  mddKey: string;
  volumePath: string;
}

export class DictionaryResourceService {
  constructor(
    private readonly database: PrismaClient,
    private readonly storage: DictionaryPackageStorage,
    private readonly mdd: MddResourceAdapter,
  ) {}

  async getResource(dictionaryId: string, logicalResourcePath: string): Promise<DictionaryResource | null> {
    const mddKey = normalizeLogicalResourcePath(logicalResourcePath);
    const dictionary = await this.database.dictionary.findUnique({
      where: { id: dictionaryId }, select: { packageStorageKey: true },
    });
    if (!dictionary?.packageStorageKey) return null;

    const volumes = await this.storage.mddVolumePaths(dictionary.packageStorageKey);
    for (const volumePath of volumes) {
      const bytes = this.mdd.lookupResource(volumePath, mddKey);
      if (bytes) return { bytes, contentType: detectResourceContentType(bytes), mddKey, volumePath };
    }
    return null;
  }
}

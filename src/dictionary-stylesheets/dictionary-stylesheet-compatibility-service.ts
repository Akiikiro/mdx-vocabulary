import type { PrismaClient } from '@prisma/client';
import { DictionaryPackageStorage } from '../storage/dictionary-package-storage.js';
import { detectStylesheetCompatibilityProfileFromFile } from './compatibility-profiles.js';

export class DictionaryStylesheetCompatibilityService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: DictionaryPackageStorage,
  ) {}

  async reconcileStoredPackages(): Promise<void> {
    const dictionaries = await this.prisma.dictionary.findMany({
      where: {
        stylesheetCompatibilityProfile: null,
        stylesheetUrl: { not: null },
        packageStorageKey: { not: null },
      },
      select: { id: true, packageStorageKey: true, stylesheetUrl: true },
    });

    for (const dictionary of dictionaries) {
      const assetPrefix = `/api/dictionaries/${dictionary.id}/assets/`;
      if (!dictionary.stylesheetUrl!.startsWith(assetPrefix)) continue;
      const assetPath = decodeURIComponent(dictionary.stylesheetUrl!.slice(assetPrefix.length));
      try {
        const profile = await detectStylesheetCompatibilityProfileFromFile(
          this.storage.stylesheetPath(dictionary.packageStorageKey!, assetPath),
        );
        if (profile) {
          await this.prisma.dictionary.update({
            where: { id: dictionary.id },
            data: { stylesheetCompatibilityProfile: profile },
          });
        }
      } catch (error) {
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
  }
}

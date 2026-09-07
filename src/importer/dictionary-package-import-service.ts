import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { detectStylesheetCompatibilityProfileFromFile } from '../dictionary-stylesheets/compatibility-profiles.js';
import {
  DictionaryPackageStorage,
  removeCommonPackageRoot,
  type StagedPackageFile,
} from '../storage/dictionary-package-storage.js';

export class DictionaryPackageValidationError extends Error {}

export interface PackageImportResult {
  dictionaryId: string;
  jobId: string;
  name: string;
  status: 'queued';
  stylesheetUrl: string | null;
  stylesheetCompatibilityProfile: string | null;
  fileCount: number;
  resourceCount: number;
}

export class DictionaryPackageImportService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: DictionaryPackageStorage,
  ) {}

  async import(stagingDirectory: string, stagedFiles: readonly StagedPackageFile[]): Promise<PackageImportResult> {
    const files = removeCommonPackageRoot(stagedFiles);
    if (files.length === 0) throw new DictionaryPackageValidationError('Dictionary package must contain files');
    if (new Set(files.map((file) => file.relativePath)).size !== files.length) {
      throw new DictionaryPackageValidationError('Dictionary package contains duplicate file paths');
    }
    const mdxFiles = files.filter((file) => extension(file.relativePath) === '.mdx');
    const cssFiles = files.filter((file) => extension(file.relativePath) === '.css');
    if (mdxFiles.length !== 1) {
      throw new DictionaryPackageValidationError('Dictionary package must contain exactly one MDX file');
    }
    if (cssFiles.length > 1) {
      throw new DictionaryPackageValidationError('Dictionary package contains multiple CSS files; Phase 1 requires zero or one');
    }

    const dictionaryId = crypto.randomUUID();
    let layout;
    try {
      layout = await this.storage.commit(stagingDirectory, dictionaryId, files, mdxFiles[0], cssFiles[0] ?? null);
      const stylesheetUrl = layout.stylesheetAssetPath
        ? `/api/dictionaries/${dictionaryId}/assets/${layout.stylesheetAssetPath.split('/').map(encodeURIComponent).join('/')}`
        : null;
      const stylesheetCompatibilityProfile = layout.stylesheetAssetPath
        ? await detectStylesheetCompatibilityProfileFromFile(
          this.storage.pathForStorageKey(`${layout.packageStorageKey}/${layout.stylesheetAssetPath}`),
        )
        : null;
      const jobId = crypto.randomUUID();
      await this.prisma.$transaction([
        this.prisma.dictionary.create({
          data: {
            id: dictionaryId,
            name: basenameWithoutExtension(mdxFiles[0].relativePath),
            sourceFilename: mdxFiles[0].relativePath.split('/').at(-1)!,
            fileChecksum: await checksumForFile(this.storage, layout.mdxStorageKey),
            storageKey: layout.mdxStorageKey,
            packageStorageKey: layout.packageStorageKey,
            stylesheetUrl,
            stylesheetCompatibilityProfile,
            status: 'queued',
          },
        }),
        this.prisma.importJob.create({ data: { id: jobId, dictionaryId } }),
      ]);
      return {
        dictionaryId,
        jobId,
        name: basenameWithoutExtension(mdxFiles[0].relativePath),
        status: 'queued',
        stylesheetUrl,
        stylesheetCompatibilityProfile,
        fileCount: files.length,
        resourceCount: files.length - 1 - cssFiles.length,
      };
    } catch (error) {
      if (layout) await this.storage.removePackage(layout.packageStorageKey);
      throw error;
    }
  }
}

function extension(value: string): string {
  const filename = value.split('/').at(-1)!;
  const match = filename.toLowerCase().match(/(?:\.\d+)?(\.mdd)$|\.[^.]+$/);
  return match?.[1] ?? match?.[0] ?? '';
}

function basenameWithoutExtension(value: string): string {
  const filename = value.split('/').at(-1)!;
  return filename.replace(/\.mdx$/i, '');
}

async function checksumForFile(storage: DictionaryPackageStorage, storageKey: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(storage.pathForStorageKey(storageKey))) hash.update(chunk);
  return hash.digest('hex');
}

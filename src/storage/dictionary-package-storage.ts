import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

export interface StagedPackageFile {
  relativePath: string;
  temporaryPath: string;
  sizeBytes: number;
}

export interface DictionaryPackageLayout {
  packageStorageKey: string;
  mdxStorageKey: string;
  stylesheetAssetPath: string | null;
}

export class InvalidPackagePathError extends Error {}

export class DictionaryPackageStorage {
  constructor(private readonly rootDirectory: string) {}

  async createStagingDirectory(): Promise<string> {
    const stagingRoot = path.join(this.rootDirectory, '.staging');
    await fsp.mkdir(stagingRoot, { recursive: true });
    return fsp.mkdtemp(path.join(stagingRoot, 'package-'));
  }

  async stageFile(stagingDirectory: string, relativePath: string, input: NodeJS.ReadableStream): Promise<StagedPackageFile> {
    const safePath = validatePackagePath(relativePath);
    const temporaryPath = path.join(stagingDirectory, `${crypto.randomUUID()}.upload`);
    let sizeBytes = 0;
    input.on('data', (chunk: Buffer) => { sizeBytes += chunk.length; });
    await pipeline(input, fs.createWriteStream(temporaryPath, { flags: 'wx' }));
    return { relativePath: safePath, temporaryPath, sizeBytes };
  }

  async commit(
    stagingDirectory: string,
    dictionaryId: string,
    files: readonly StagedPackageFile[],
    mdxFile: StagedPackageFile,
    stylesheetFile: StagedPackageFile | null,
  ): Promise<DictionaryPackageLayout> {
    const packageStorageKey = path.posix.join('dictionaries', dictionaryId);
    const finalDirectory = this.resolveStorageKey(packageStorageKey);
    const preparedDirectory = path.join(stagingDirectory, 'prepared');
    await fsp.mkdir(path.join(preparedDirectory, 'resources'), { recursive: true });
    await fsp.mkdir(path.join(preparedDirectory, 'styles'), { recursive: true });

    for (const file of files) {
      let destination: string;
      if (file === mdxFile) {
        destination = path.join(preparedDirectory, 'source.mdx');
      } else if (file === stylesheetFile) {
        destination = path.join(preparedDirectory, 'styles', path.posix.basename(file.relativePath));
      } else {
        destination = path.join(preparedDirectory, 'resources', ...file.relativePath.split('/'));
      }
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      await fsp.rename(file.temporaryPath, destination);
    }

    await fsp.mkdir(path.dirname(finalDirectory), { recursive: true });
    await fsp.rename(preparedDirectory, finalDirectory);
    await this.cleanup(stagingDirectory);
    const stylesheetAssetPath = stylesheetFile
      ? path.posix.join('styles', path.posix.basename(stylesheetFile.relativePath))
      : null;
    return {
      packageStorageKey,
      mdxStorageKey: path.posix.join(packageStorageKey, 'source.mdx'),
      stylesheetAssetPath,
    };
  }

  async cleanup(stagingDirectory: string): Promise<void> {
    await fsp.rm(stagingDirectory, { recursive: true, force: true });
  }

  async removePackage(packageStorageKey: string): Promise<void> {
    await fsp.rm(this.resolveStorageKey(packageStorageKey), { recursive: true, force: true });
  }

  stylesheetPath(packageStorageKey: string, assetPath: string): string {
    if (!assetPath.startsWith('styles/') || path.posix.extname(assetPath).toLowerCase() !== '.css') {
      throw new InvalidPackagePathError('Only dictionary CSS assets are available');
    }
    const safeAssetPath = validatePackagePath(assetPath);
    return this.resolveStorageKey(path.posix.join(packageStorageKey, safeAssetPath));
  }

  pathForStorageKey(storageKey: string): string {
    return this.resolveStorageKey(storageKey);
  }

  private resolveStorageKey(storageKey: string): string {
    const safeKey = validatePackagePath(storageKey);
    const resolved = path.resolve(this.rootDirectory, ...safeKey.split('/'));
    const root = `${path.resolve(this.rootDirectory)}${path.sep}`;
    if (!resolved.startsWith(root)) throw new InvalidPackagePathError('Package path escapes storage root');
    return resolved;
  }
}

export function validatePackagePath(value: string): string {
  if (!value || value.includes('\0') || value.includes('\\') || value.startsWith('/') || path.win32.isAbsolute(value)) {
    throw new InvalidPackagePathError('Invalid package file path');
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new InvalidPackagePathError('Invalid package file path');
  }
  return segments.join('/');
}

export function removeCommonPackageRoot(files: readonly StagedPackageFile[]): StagedPackageFile[] {
  const segments = files.map((file) => file.relativePath.split('/'));
  const commonRoot = segments.length > 0 && segments.every((parts) => parts.length > 1 && parts[0] === segments[0][0]);
  return files.map((file, index) => ({
    ...file,
    relativePath: commonRoot ? segments[index].slice(1).join('/') : file.relativePath,
  }));
}

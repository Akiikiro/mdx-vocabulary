import { MDD } from 'js-mdict';

export interface MddResourceAdapter {
  lookupResource(mddPath: string, resourceKey: string): Buffer | null;
  close?(): void;
}

interface OpenMdd {
  locate(resourceKey: string): { definition: string | null };
  close(): void;
}

export type OpenMddFactory = (mddPath: string) => OpenMdd;

/** Keeps js-mdict and its Base64 return format behind the mdx module boundary. */
export class JsMddResourceAdapter implements MddResourceAdapter {
  private readonly openVolumes = new Map<string, OpenMdd>();

  constructor(
    private readonly maxOpenVolumes = 8,
    private readonly openMdd: OpenMddFactory = (mddPath) => new MDD(mddPath),
  ) {}

  lookupResource(mddPath: string, resourceKey: string): Buffer | null {
    const mdd = this.getVolume(mddPath);
    const result = mdd.locate(resourceKey);
    return result.definition === null ? null : Buffer.from(result.definition, 'base64');
  }

  close(): void {
    for (const mdd of this.openVolumes.values()) mdd.close();
    this.openVolumes.clear();
  }

  private getVolume(mddPath: string): OpenMdd {
    const existing = this.openVolumes.get(mddPath);
    if (existing) {
      this.openVolumes.delete(mddPath);
      this.openVolumes.set(mddPath, existing);
      return existing;
    }

    const opened = this.openMdd(mddPath);
    this.openVolumes.set(mddPath, opened);
    if (this.openVolumes.size > this.maxOpenVolumes) {
      const oldestPath = this.openVolumes.keys().next().value as string;
      this.openVolumes.get(oldestPath)?.close();
      this.openVolumes.delete(oldestPath);
    }
    return opened;
  }
}

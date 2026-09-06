import type { Prisma, PrismaClient } from '@prisma/client';

export interface VocabularyEntryDTO {
  id: string;
  dictionaryId: string;
  headword: string;
  kind: 'definition' | 'redirect' | 'unknown';
  plainText: string;
  redirectTarget: string | null;
  sourceOrdinal: number;
}

export interface VocabularyItemDTO {
  id: string;
  entryId: string;
  createdAt: string;
  entry: VocabularyEntryDTO;
}

export interface AddVocabularyResult {
  item: VocabularyItemDTO;
  created: boolean;
}

export class VocabularyEntryNotFoundError extends Error {}
export class VocabularyItemNotFoundError extends Error {}

const vocabularySelect = {
  id: true,
  entryId: true,
  createdAt: true,
  entry: {
    select: {
      id: true,
      dictionaryId: true,
      headwordOriginal: true,
      entryKind: true,
      entryPlainText: true,
      redirectTargetOriginal: true,
      sourceOrdinal: true,
    },
  },
} satisfies Prisma.VocabularyItemSelect;

type VocabularyRow = Prisma.VocabularyItemGetPayload<{ select: typeof vocabularySelect }>;

function toDTO(row: VocabularyRow): VocabularyItemDTO {
  return {
    id: row.id,
    entryId: row.entryId,
    createdAt: row.createdAt.toISOString(),
    entry: {
      id: row.entry.id,
      dictionaryId: row.entry.dictionaryId,
      headword: row.entry.headwordOriginal,
      kind: row.entry.entryKind,
      plainText: row.entry.entryPlainText,
      redirectTarget: row.entry.redirectTargetOriginal,
      sourceOrdinal: row.entry.sourceOrdinal,
    },
  };
}

export class VocabularyService {
  constructor(private readonly prisma: PrismaClient) {}

  async add(entryId: string): Promise<AddVocabularyResult> {
    const entry = await this.prisma.dictionaryEntry.findUnique({
      where: { id: entryId },
      select: { id: true },
    });
    if (!entry) throw new VocabularyEntryNotFoundError('Dictionary entry not found');

    const existing = await this.prisma.vocabularyItem.findUnique({
      where: { entryId },
      select: vocabularySelect,
    });
    if (existing) return { item: toDTO(existing), created: false };

    try {
      const item = await this.prisma.vocabularyItem.create({
        data: { entryId },
        select: vocabularySelect,
      });
      return { item: toDTO(item), created: true };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const item = await this.prisma.vocabularyItem.findUniqueOrThrow({
          where: { entryId },
          select: vocabularySelect,
        });
        return { item: toDTO(item), created: false };
      }
      throw error;
    }
  }

  async list(): Promise<VocabularyItemDTO[]> {
    const rows = await this.prisma.vocabularyItem.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: vocabularySelect,
    });
    return rows.map(toDTO);
  }

  async remove(id: string): Promise<void> {
    const result = await this.prisma.vocabularyItem.deleteMany({ where: { id } });
    if (result.count === 0) throw new VocabularyItemNotFoundError('Vocabulary item not found');
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

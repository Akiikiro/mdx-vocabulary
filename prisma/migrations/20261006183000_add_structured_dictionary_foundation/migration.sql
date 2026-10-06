-- CreateEnum
CREATE TYPE "ContentModel" AS ENUM ('html', 'structured');

-- Add generic dictionary source and content metadata.
ALTER TABLE "dictionaries"
ADD COLUMN "source_format" TEXT,
ADD COLUMN "source_language" TEXT,
ADD COLUMN "target_languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "content_model" "ContentModel",
ADD COLUMN "source_metadata" JSONB;

-- Existing dictionaries are MDX dictionaries with HTML entry content.
UPDATE "dictionaries"
SET "source_format" = 'mdx',
    "content_model" = 'html';

ALTER TABLE "dictionaries"
ALTER COLUMN "source_format" SET NOT NULL,
ALTER COLUMN "source_format" SET DEFAULT 'mdx',
ALTER COLUMN "content_model" SET NOT NULL,
ALTER COLUMN "content_model" SET DEFAULT 'html';

-- Preserve a source-owned entry identifier, scoped to its dictionary.
ALTER TABLE "dictionary_entries"
ADD COLUMN "source_record_id" TEXT;

-- CreateTable
CREATE TABLE "structured_entries" (
    "entry_id" UUID NOT NULL,

    CONSTRAINT "structured_entries_pkey" PRIMARY KEY ("entry_id")
);

-- CreateTable
CREATE TABLE "structured_forms" (
    "id" UUID NOT NULL,
    "structured_entry_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "normalized_text" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "kind" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "priority_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "restrictions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "structured_forms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "structured_forms_ordinal_check" CHECK ("ordinal" >= 0)
);

-- CreateTable
CREATE TABLE "structured_senses" (
    "id" UUID NOT NULL,
    "structured_entry_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "source_sense_ordinal" INTEGER,
    "part_of_speech" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "domains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,

    CONSTRAINT "structured_senses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "structured_senses_ordinal_check" CHECK ("ordinal" >= 0),
    CONSTRAINT "structured_senses_source_ordinal_check"
        CHECK ("source_sense_ordinal" IS NULL OR "source_sense_ordinal" >= 0)
);

-- CreateTable
CREATE TABLE "structured_entry_definitions" (
    "id" UUID NOT NULL,
    "structured_entry_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "provenance" JSONB,
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "structured_entry_definitions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "structured_entry_definitions_ordinal_check" CHECK ("ordinal" >= 0)
);

-- CreateTable
CREATE TABLE "structured_sense_definitions" (
    "id" UUID NOT NULL,
    "sense_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "provenance" JSONB,
    "ordinal" INTEGER NOT NULL,

    CONSTRAINT "structured_sense_definitions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "structured_sense_definitions_ordinal_check" CHECK ("ordinal" >= 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_entries_dictionary_id_source_record_id_key"
ON "dictionary_entries"("dictionary_id", "source_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "structured_forms_structured_entry_id_ordinal_key"
ON "structured_forms"("structured_entry_id", "ordinal");

-- CreateIndex
CREATE INDEX "structured_forms_normalized_text_idx"
ON "structured_forms"("normalized_text");

-- CreateIndex
CREATE UNIQUE INDEX "structured_senses_structured_entry_id_ordinal_key"
ON "structured_senses"("structured_entry_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "structured_senses_entry_source_ordinal_key"
ON "structured_senses"("structured_entry_id", "source_sense_ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "entry_definitions_parent_language_source_ordinal_key"
ON "structured_entry_definitions"("structured_entry_id", "language", "source", "ordinal");

-- CreateIndex
CREATE INDEX "structured_entry_definitions_language_idx"
ON "structured_entry_definitions"("language");

-- CreateIndex
CREATE UNIQUE INDEX "sense_definitions_parent_language_source_ordinal_key"
ON "structured_sense_definitions"("sense_id", "language", "source", "ordinal");

-- CreateIndex
CREATE INDEX "structured_sense_definitions_language_idx"
ON "structured_sense_definitions"("language");

-- AddForeignKey
ALTER TABLE "structured_entries"
ADD CONSTRAINT "structured_entries_entry_id_fkey"
FOREIGN KEY ("entry_id") REFERENCES "dictionary_entries"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structured_forms"
ADD CONSTRAINT "structured_forms_structured_entry_id_fkey"
FOREIGN KEY ("structured_entry_id") REFERENCES "structured_entries"("entry_id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structured_senses"
ADD CONSTRAINT "structured_senses_structured_entry_id_fkey"
FOREIGN KEY ("structured_entry_id") REFERENCES "structured_entries"("entry_id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structured_entry_definitions"
ADD CONSTRAINT "structured_entry_definitions_structured_entry_id_fkey"
FOREIGN KEY ("structured_entry_id") REFERENCES "structured_entries"("entry_id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structured_sense_definitions"
ADD CONSTRAINT "structured_sense_definitions_sense_id_fkey"
FOREIGN KEY ("sense_id") REFERENCES "structured_senses"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "ContentBlockKind" AS ENUM (
    'definition', 'example', 'annotation', 'section', 'subdivision', 'raw'
);

-- CreateEnum
CREATE TYPE "ContentAnnotationKind" AS ENUM (
    'note', 'grammar', 'orthography', 'usage', 'caution', 'expression',
    'etymology', 'derivative', 'other'
);

-- CreateEnum
CREATE TYPE "ContentTextRole" AS ENUM (
    'source', 'translation', 'transliteration', 'definition', 'label', 'body', 'other'
);

-- The composite keys below let optional sense and parent ownership be enforced
-- without trusting application code to keep referenced rows in the same entry.
CREATE UNIQUE INDEX "structured_senses_entry_id_key"
ON "structured_senses"("structured_entry_id", "id");

-- CreateTable
CREATE TABLE "structured_content_blocks" (
    "id" UUID NOT NULL,
    "structured_entry_id" UUID NOT NULL,
    "parent_block_id" UUID,
    "sense_id" UUID,
    "kind" "ContentBlockKind" NOT NULL,
    "annotation_kind" "ContentAnnotationKind",
    "ordinal" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "provenance" JSONB,

    CONSTRAINT "structured_content_blocks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "structured_content_blocks_ordinal_check" CHECK ("ordinal" >= 0),
    CONSTRAINT "structured_content_blocks_parent_check" CHECK ("parent_block_id" IS NULL OR "parent_block_id" <> "id"),
    CONSTRAINT "structured_content_blocks_annotation_check" CHECK (
        ("kind" IN ('annotation', 'section') AND "annotation_kind" IS NOT NULL)
        OR ("kind" NOT IN ('annotation', 'section') AND "annotation_kind" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "structured_examples" (
    "id" UUID NOT NULL,
    "structured_entry_id" UUID NOT NULL,
    "sense_id" UUID,
    "ordinal" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "provenance" JSONB,
    "content_block_id" UUID,

    CONSTRAINT "structured_examples_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "structured_examples_ordinal_check" CHECK ("ordinal" >= 0)
);

-- CreateTable
CREATE TABLE "structured_example_texts" (
    "id" UUID NOT NULL,
    "example_id" UUID NOT NULL,
    "language" TEXT,
    "role" "ContentTextRole" NOT NULL,
    "text" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "provenance" JSONB,

    CONSTRAINT "structured_example_texts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "structured_example_texts_ordinal_check" CHECK ("ordinal" >= 0)
);

-- CreateTable
CREATE TABLE "structured_content_texts" (
    "id" UUID NOT NULL,
    "content_block_id" UUID NOT NULL,
    "language" TEXT,
    "role" "ContentTextRole" NOT NULL,
    "text" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "provenance" JSONB,

    CONSTRAINT "structured_content_texts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "structured_content_texts_ordinal_check" CHECK ("ordinal" >= 0)
);

-- CreateTable
CREATE TABLE "entry_source_artifacts" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "source_format" TEXT NOT NULL,
    "source_identity" JSONB NOT NULL,
    "parser_name" TEXT NOT NULL,
    "parser_version" TEXT NOT NULL,
    "representation_version" INTEGER NOT NULL,
    "raw_payload" TEXT,
    "raw_payload_bytes" BYTEA,
    "parsed_representation" JSONB,
    "diagnostics" JSONB,
    "source_metadata" JSONB,
    "content_checksum" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entry_source_artifacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "entry_source_artifacts_representation_version_check" CHECK ("representation_version" > 0),
    CONSTRAINT "entry_source_artifacts_payload_check" CHECK (
        ("raw_payload" IS NOT NULL AND "raw_payload_bytes" IS NULL)
        OR ("raw_payload" IS NULL AND "raw_payload_bytes" IS NOT NULL)
    )
);

-- Stable semantic ordering independent of insertion order.
CREATE UNIQUE INDEX "structured_examples_entry_ordinal_key"
ON "structured_examples"("structured_entry_id", "ordinal");
CREATE UNIQUE INDEX "structured_examples_entry_content_block_key"
ON "structured_examples"("structured_entry_id", "content_block_id");
CREATE INDEX "structured_examples_sense_id_idx" ON "structured_examples"("sense_id");

CREATE UNIQUE INDEX "structured_example_texts_example_id_ordinal_key"
ON "structured_example_texts"("example_id", "ordinal");
CREATE INDEX "structured_example_texts_language_idx" ON "structured_example_texts"("language");

CREATE UNIQUE INDEX "structured_content_blocks_entry_id_key"
ON "structured_content_blocks"("structured_entry_id", "id");
CREATE INDEX "structured_content_blocks_entry_parent_ordinal_idx"
ON "structured_content_blocks"("structured_entry_id", "parent_block_id", "ordinal");
CREATE INDEX "structured_content_blocks_sense_id_idx" ON "structured_content_blocks"("sense_id");
CREATE UNIQUE INDEX "structured_content_blocks_root_ordinal_key"
ON "structured_content_blocks"("structured_entry_id", "ordinal")
WHERE "parent_block_id" IS NULL;
CREATE UNIQUE INDEX "structured_content_blocks_child_ordinal_key"
ON "structured_content_blocks"("structured_entry_id", "parent_block_id", "ordinal")
WHERE "parent_block_id" IS NOT NULL;

CREATE UNIQUE INDEX "structured_content_texts_block_ordinal_key"
ON "structured_content_texts"("content_block_id", "ordinal");
CREATE INDEX "structured_content_texts_language_idx" ON "structured_content_texts"("language");

CREATE UNIQUE INDEX "entry_source_artifacts_version_key"
ON "entry_source_artifacts"(
    "entry_id", "parser_name", "parser_version", "representation_version", "content_checksum"
);
CREATE INDEX "entry_source_artifacts_source_format_idx" ON "entry_source_artifacts"("source_format");

-- AddForeignKey
ALTER TABLE "structured_content_blocks"
ADD CONSTRAINT "structured_content_blocks_structured_entry_id_fkey"
FOREIGN KEY ("structured_entry_id") REFERENCES "structured_entries"("entry_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "structured_content_blocks"
ADD CONSTRAINT "structured_content_blocks_entry_sense_fkey"
FOREIGN KEY ("structured_entry_id", "sense_id")
REFERENCES "structured_senses"("structured_entry_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "structured_content_blocks"
ADD CONSTRAINT "structured_content_blocks_entry_parent_fkey"
FOREIGN KEY ("structured_entry_id", "parent_block_id")
REFERENCES "structured_content_blocks"("structured_entry_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "structured_examples"
ADD CONSTRAINT "structured_examples_structured_entry_id_fkey"
FOREIGN KEY ("structured_entry_id") REFERENCES "structured_entries"("entry_id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "structured_examples"
ADD CONSTRAINT "structured_examples_entry_sense_fkey"
FOREIGN KEY ("structured_entry_id", "sense_id")
REFERENCES "structured_senses"("structured_entry_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "structured_examples"
ADD CONSTRAINT "structured_examples_entry_content_block_fkey"
FOREIGN KEY ("structured_entry_id", "content_block_id")
REFERENCES "structured_content_blocks"("structured_entry_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "structured_example_texts"
ADD CONSTRAINT "structured_example_texts_example_id_fkey"
FOREIGN KEY ("example_id") REFERENCES "structured_examples"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "structured_content_texts"
ADD CONSTRAINT "structured_content_texts_content_block_id_fkey"
FOREIGN KEY ("content_block_id") REFERENCES "structured_content_blocks"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "entry_source_artifacts"
ADD CONSTRAINT "entry_source_artifacts_entry_id_fkey"
FOREIGN KEY ("entry_id") REFERENCES "dictionary_entries"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

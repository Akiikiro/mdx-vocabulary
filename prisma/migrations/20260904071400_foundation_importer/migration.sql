-- CreateEnum
CREATE TYPE "DictionaryStatus" AS ENUM ('uploaded', 'queued', 'importing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "EntryKind" AS ENUM ('definition', 'redirect', 'unknown');

-- CreateTable
CREATE TABLE "dictionaries" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source_filename" TEXT NOT NULL,
    "file_checksum" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" "DictionaryStatus" NOT NULL DEFAULT 'uploaded',
    "mdx_format_version" TEXT,
    "source_encoding" TEXT,
    "header_metadata" JSONB,
    "parser_name" TEXT,
    "parser_version" TEXT,
    "entry_count" INTEGER,
    "failure_summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_at" TIMESTAMP(3),

    CONSTRAINT "dictionaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dictionary_entries" (
    "id" UUID NOT NULL,
    "dictionary_id" UUID NOT NULL,
    "headword_original" TEXT NOT NULL,
    "headword_normalized" TEXT NOT NULL,
    "sort_key" TEXT NOT NULL,
    "entry_raw" TEXT NOT NULL,
    "entry_sanitized_html" TEXT NOT NULL,
    "entry_plain_text" TEXT NOT NULL,
    "entry_kind" "EntryKind" NOT NULL DEFAULT 'definition',
    "redirect_target_original" TEXT,
    "source_ordinal" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dictionary_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "dictionary_id" UUID NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'queued',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "claimed_by" TEXT,
    "claimed_at" TIMESTAMP(3),
    "progress_current" INTEGER NOT NULL DEFAULT 0,
    "progress_total" INTEGER,
    "error_detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dictionaries_storage_key_key" ON "dictionaries"("storage_key");

-- CreateIndex
CREATE INDEX "dictionaries_status_idx" ON "dictionaries"("status");

-- CreateIndex
CREATE INDEX "dictionary_entries_dictionary_id_headword_normalized_idx" ON "dictionary_entries"("dictionary_id", "headword_normalized");

-- CreateIndex
CREATE INDEX "dictionary_entries_dictionary_id_sort_key_idx" ON "dictionary_entries"("dictionary_id", "sort_key");

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_entries_dictionary_id_source_ordinal_key" ON "dictionary_entries"("dictionary_id", "source_ordinal");

-- CreateIndex
CREATE INDEX "import_jobs_status_created_at_idx" ON "import_jobs"("status", "created_at");

-- AddForeignKey
ALTER TABLE "dictionary_entries" ADD CONSTRAINT "dictionary_entries_dictionary_id_fkey" FOREIGN KEY ("dictionary_id") REFERENCES "dictionaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_dictionary_id_fkey" FOREIGN KEY ("dictionary_id") REFERENCES "dictionaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

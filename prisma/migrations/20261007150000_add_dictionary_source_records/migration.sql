-- Source records are private import/reprocessing data. They are not dictionary entries and are never searched directly.
CREATE TABLE "dictionary_source_records" (
    "id" UUID NOT NULL,
    "dictionary_id" UUID NOT NULL,
    "entry_id" UUID,
    "source_key" TEXT NOT NULL,
    "source_ordinal" INTEGER NOT NULL,
    "record_kind" TEXT NOT NULL,
    "source_identity" JSONB NOT NULL,
    "raw_payload" TEXT,
    "raw_payload_bytes" BYTEA,
    "content_checksum" TEXT NOT NULL,
    "source_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dictionary_source_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dictionary_source_records_source_ordinal_check" CHECK ("source_ordinal" >= 0),
    CONSTRAINT "dictionary_source_records_payload_check" CHECK (
        (("raw_payload" IS NOT NULL)::integer + ("raw_payload_bytes" IS NOT NULL)::integer) = 1
    )
);

CREATE TABLE "dictionary_source_artifacts" (
    "id" UUID NOT NULL,
    "source_record_id" UUID NOT NULL,
    "parser_name" TEXT NOT NULL,
    "parser_version" TEXT NOT NULL,
    "representation_version" INTEGER NOT NULL,
    "parsed_representation" JSONB,
    "diagnostics" JSONB,
    "artifact_metadata" JSONB,
    "representation_checksum" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dictionary_source_artifacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dictionary_source_artifacts_representation_version_check" CHECK ("representation_version" > 0)
);

CREATE UNIQUE INDEX "dictionary_entries_dictionary_id_id_key"
ON "dictionary_entries"("dictionary_id", "id");

CREATE UNIQUE INDEX "dictionary_source_records_dictionary_entry_key"
ON "dictionary_source_records"("dictionary_id", "entry_id");

CREATE UNIQUE INDEX "dictionary_source_records_dictionary_source_key_key"
ON "dictionary_source_records"("dictionary_id", "source_key");

CREATE UNIQUE INDEX "dictionary_source_records_dictionary_ordinal_key"
ON "dictionary_source_records"("dictionary_id", "source_ordinal");

CREATE INDEX "dictionary_source_records_dictionary_kind_idx"
ON "dictionary_source_records"("dictionary_id", "record_kind");

CREATE UNIQUE INDEX "dictionary_source_artifacts_version_key"
ON "dictionary_source_artifacts"("source_record_id", "parser_name", "parser_version", "representation_version");

ALTER TABLE "dictionary_source_records"
ADD CONSTRAINT "dictionary_source_records_dictionary_id_fkey"
FOREIGN KEY ("dictionary_id") REFERENCES "dictionaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dictionary_source_records"
ADD CONSTRAINT "dictionary_source_records_dictionary_entry_fkey"
FOREIGN KEY ("dictionary_id", "entry_id") REFERENCES "dictionary_entries"("dictionary_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dictionary_source_artifacts"
ADD CONSTRAINT "dictionary_source_artifacts_source_record_id_fkey"
FOREIGN KEY ("source_record_id") REFERENCES "dictionary_source_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

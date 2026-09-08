ALTER TABLE "dictionary_entries"
ADD COLUMN "mdx_locator_version" INTEGER,
ADD COLUMN "mdx_locator_file_checksum" TEXT,
ADD COLUMN "mdx_locator_key_text" TEXT,
ADD COLUMN "mdx_locator_key_block_index" INTEGER,
ADD COLUMN "mdx_locator_record_start_offset" BIGINT,
ADD COLUMN "mdx_locator_record_end_offset" BIGINT;

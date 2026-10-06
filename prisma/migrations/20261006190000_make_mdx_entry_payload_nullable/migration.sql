ALTER TABLE "dictionary_entries"
ALTER COLUMN "entry_raw" DROP NOT NULL,
ALTER COLUMN "entry_sanitized_html" DROP NOT NULL;

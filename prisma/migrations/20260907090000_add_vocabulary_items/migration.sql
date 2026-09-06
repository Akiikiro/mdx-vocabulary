CREATE TABLE "vocabulary_items" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vocabulary_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vocabulary_items_entry_id_key" ON "vocabulary_items"("entry_id");

ALTER TABLE "vocabulary_items"
ADD CONSTRAINT "vocabulary_items_entry_id_fkey"
FOREIGN KEY ("entry_id") REFERENCES "dictionary_entries"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

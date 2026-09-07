ALTER TABLE "dictionaries" ADD COLUMN "stylesheet_url" TEXT;

UPDATE "dictionaries"
SET "stylesheet_url" = '/dictionaries/oxford8/O8C.css'
WHERE "source_filename" = '牛津高阶8简体.mdx';

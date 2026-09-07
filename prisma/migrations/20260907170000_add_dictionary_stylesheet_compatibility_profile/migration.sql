ALTER TABLE "dictionaries"
ADD COLUMN "stylesheet_compatibility_profile" TEXT;

-- Preserve the compatibility behavior of the existing bundled Oxford stylesheet.
UPDATE "dictionaries"
SET "stylesheet_compatibility_profile" = 'oxford8'
WHERE "stylesheet_url" = '/dictionaries/oxford8/O8C.css';

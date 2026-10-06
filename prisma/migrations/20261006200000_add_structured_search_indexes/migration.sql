-- Support anchored prefix lookup without scanning all structured entries or forms.
CREATE INDEX "dictionary_entries_dictionary_headword_pattern_idx"
ON "dictionary_entries"("dictionary_id", "headword_normalized" text_pattern_ops);

CREATE INDEX "structured_forms_normalized_text_pattern_idx"
ON "structured_forms"("normalized_text" text_pattern_ops);

#!/usr/bin/env python3
"""Render the Meikyo full-corpus audit JSON as the requested Markdown report."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def table(headers, rows):
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    for row in rows:
        lines.append("| " + " | ".join(str(x).replace("|", "\\|").replace("\n", "<br>") for x in row) + " |")
    return "\n".join(lines)


def raw_block(text):
    return "```text\n" + text.rstrip("\n") + "\n```"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audit", type=Path)
    ap.add_argument("output", type=Path)
    args = ap.parse_args()
    d = json.loads(args.audit.read_text(encoding="utf-8"))
    c, m = d["container"], d["markers"]
    total = c["index_records"]
    shape_top = d["shapes"]["top"]
    cumulative = 0
    shape_rows = []
    for i, item in enumerate(shape_top[:50], 1):
        cumulative += item["entries"]
        shape_rows.append((i, f'`{item["shape"]}`', item["entries"], f'{item["entries"] / total:.3%}', f'{cumulative / total:.3%}', ", ".join(item["examples"])))
    nonlinks = total - d["links"]["counts"]["records"]
    classified_nonlinks = nonlinks - d["shapes"]["entries_with_unclassified_lines"]
    exdist = dict(d["examples"]["entry_example_count_distribution"])
    example_total = sum(int(k) * v for k, v in exdist.items())
    quote_counts = d["quotes"]["character_counts"]
    selected = d["selected"]

    parts = ["# Meikyo Parser Audit", "",
    "> Scope: read-only, full-corpus structural audit of **明镜日汉双解辞典**. No source bytes, production code, schema, importer, API, query, or frontend files were changed. Counts below come from all 209,052 index records, not a sample.", "",
    "## 1. StarDict container validation", "",
    f"The `.ifo` declares `wordcount={d['ifo']['wordcount']}`, `idxfilesize={d['ifo']['idxfilesize']}`, and `sametypesequence={d['ifo']['sametypesequence']}`. It has no `idxoffsetbits`, so StarDict's default 32-bit big-endian offset applies. Lowercase `m` is a UTF-8 plain-text payload. The `.idx` size matches the declaration exactly.", "",
    table(["Check", "Result"], [
        ("Index records", f"{total:,}"), ("Unique headwords", f"{c['unique_headwords']:,}"),
        ("Duplicate records/headwords", f"{c['duplicate_headword_records']:,} / {len(c['duplicate_headwords']):,}"),
        ("Index bytes consumed", f"{c['index_consumed_bytes']:,} of {c['index_bytes']:,}"),
        ("Decompressed payload", f"{c['payload_bytes']:,} bytes"),
        ("Maximum resolved end", f"{c['max_resolved_end']:,} (exact payload end)"),
        ("Invalid offsets / sizes", f"{len(c['invalid_offsets'])} / {len(c['invalid_sizes'])}"),
        ("UTF-8 failures / zero lengths", f"{len(c['payload_decode_failures'])} / {len(c['zero_lengths'])}"),
        ("Entry bytes min / median / max", f"{c['minimum_size']:,} / {c['median_size']:,.1f} / {c['maximum_size']:,}"),
        ("Entry bytes mean", f"{c['mean_size']:,.3f}"),
        ("`.idx.oft`", f"{c['idx_oft']['value_count']:,} values; {c['idx_oft']['mismatches']} mismatches against every 32nd record start plus EOF"),
    ]), "",
    "All index extents resolve within the decompressed payload. They are unique, ordered, non-overlapping, contiguous, and end exactly at byte 53,664,545. `.idx.oft` begins with `StarDict's Cache, Version: 0.2`, followed by four opaque bytes (`c1d1a451`) and a valid little-endian cache table.", "",
    "File fingerprints:", "",
    table(["File", "Bytes", "SHA-256"], [(Path(v["path"]).name, f'{v["bytes"]:,}', f'`{v["sha256"]}`') for v in d["files"].values()]), "",
    "## 2. Corpus statistics", "",
    f"The scan decoded {d['coverage']['records_decoded']:,}/{d['coverage']['records_total']:,} records (100%). There are no duplicate index headwords, but that does not make the payload uniform: 43,095 records are custom link records, 874 are plain redirects, 121,757 begin directly with a `【...】` label, and 43,326 have some other explicit first line.", "",
    table(["Payload start / heading pattern", "Entries", "Examples"], [(x["pattern"], f'{x["entries"]:,}', "; ".join(y["headword"] for y in x["examples"])) for x in d["headings"]["patterns"]]), "",
    "The index headword is therefore authoritative as an index key only. It cannot universally be reused as a parsed display heading, and the payload's first line cannot universally be treated as a heading.", "",
    "## 3. Complete marker inventory", "",
    table(["Marker", "Structural line starts", "All text occurrences", "Entries with structural use"], [(x["marker"], f'{x["structural_occurrences"]:,}', f'{x["all_text_occurrences"]:,}', f'{x["entries"]:,}') for x in m["primary"]]), "",
    "Structural counts require the marker to be the first character of a nonempty physical line. The all-text column is an exhaustiveness check: extra occurrences are quotations, cross-references, or inline subdivisions and are not silently promoted to definition boundaries.", "",
    f"There are {m['sequence_count']:,} distinct complete primary-marker sequences. `◯` occurs in entries with a single unnumbered block, but it is not a single-sense guarantee: `◯◯` occurs in 1,437 entries, and `◯` coexists with numbered markers in {m['mixed_circle_numbered_entries']:,}. Numbered markers repeat in {m['repeated_number_entries']:,} entries, skip a number in {m['skipping_number_entries']:,}, and restart or decrease in {m['restart_or_decrease_entries']:,}. Repeats often delimit a new grammatical/homograph block, but sometimes restart without an explicit separator. Skips are genuine source patterns. The source grammar must preserve the observed sequence instead of validating it as one monotonic sense list.", "",
    "Most common complete sequences:", "",
    table(["Sequence", "Entries", "Examples"], [(x["value"], f'{x["count"]:,}', ", ".join(x["examples"])) for x in m["common_sequences"]]), "",
    "Other marker systems occur inside blocks:", "",
    table(["System", "Occurrences", "Entries", "Example"], [(x["system"], f'{x["occurrences"]:,}', f'{x["entries"]:,}', x["examples"][0]["snippet"] if x["examples"] else "") for x in m["nested"]]), "",
    "These systems can be nested on the same physical line. They are source-local subdivisions, enumeration, or explanatory structure; none is safe to flatten into top-level canonical senses without contextual validation.", "",
    "## 4. Complete `【...】` inventory", "",
    f"Exactly {len(d['pos'])} distinct values occur as a complete line. The notation includes POS, transitivity, conjugation class, classical inflection, syntactic subtype, and composites. It is not a POS-only field.", "",
    table(["Raw value", "Occurrences", "Representative headwords"], [(f'`【{x["raw"]}】`', f'{x["occurrences"]:,}', ", ".join(x["headwords"])) for x in d["pos"]]), "",
    "## 5. Complete `◈` inventory", "",
    table(["Label after `◈`", "Occurrences", "Entries", "Representative line"], [(x["label"], f'{x["occurrences"]:,}', f'{x["entries"]:,}', x["examples"][0]["line"] if x["examples"] else "") for x in d["diamond"]]), "",
    "The complete controlled prefix set is `表記`, `語法`, `表現`, `注意`, and `語源`. “(unlabeled)” means the prose starts immediately after `◈`; it is not an undiscovered label. A single line may concatenate further tokens such as `表記`, `文`, or `名`, so the safe AST stores the raw line and an optional recognized prefix.", "",
    "## 6. Definition and sense grammar", "",
    "A common lexical block is an optional explicit heading, one or more standalone `【...】` labels, then definition lines beginning with `◯` or `①`–`⑳`. Example, note, expression, and derivative lines can follow a definition. A new label or a numbering restart may begin another grammatical block. Some entries omit a heading, label, or definition entirely; some idiom fragments begin directly with definition/example prose.", "",
    "`◯` denotes an unnumbered definition block, not necessarily an entry with exactly one semantic sense. Circled numbers are ordered source blocks, but repetition, restart, skip, and mixed `◯`/numbered sequences prove that a parser must retain the marker token and block position. Circled katakana, parenthesized Unicode numbers, ASCII `(n)`, and `[n]` form subordinate systems. Proposed AST names them `DefinitionBlock` and `Subdivision` rather than prematurely asserting canonical `Sense`.", "",
    "## 7. Japanese/Chinese alignment", "",
    table(["Line class", "Slash shape", "Lines", "Entries", "Representative raw line"], [(kind, x["shape"], f'{x["line_occurrences"]:,}', f'{x["entries"]:,}', x["examples"][0]["line"] if x["examples"] else "") for kind, values in d["slashes"].items() for x in values]), "",
    "For definition lines, 222,566 have exactly one slash and an obvious kana-bearing Japanese left side with a Han-bearing right side. Another 10,492 one-slash lines are structurally consistent but cannot be proven by script alone because Japanese can contain only kanji/katakana. There are 235 right-only definitions, 101 definitions with no slash, and 160 with multiple slashes. Multiple slashes include units and ratios such as `c/s`, `1/100`, and `1/683`; elsewhere slash separates derivatives or occurs in link text. Therefore only a block-specific split rule is safe: for a recognized definition/example line, split at a validated boundary and preserve the unsplit raw text; never globally split `/`.", "",
    "## 8. Example grammar", "",
    f"There are {example_total:,} physical example lines. Every recognized example line begins with `｢`; the corpus contains {quote_counts.get('｢', 0):,} `｢` and {quote_counts.get('｣', 0):,} `｣` characters overall because some lines contain nested or multiple quoted units. Recognized lines have 170,846 obvious one-slash Japanese/Chinese pairs, 32,897 structurally paired but script-ambiguous lines, and six multi-slash anomalies. No recognized example line lacks a slash.", "",
    table(["Examples per entry", "Entries"], [(k, f'{v:,}') for k, v in d["examples"]["entry_example_count_distribution"][:15]] + [("16+ (long tail)", f'{sum(v for k,v in d["examples"]["entry_example_count_distribution"] if k >= 16):,}')]), "",
    f"Examples occur before a note marker {d['examples']['before_notes']:,} times and after one {d['examples']['after_notes']:,} times. Thus examples attach to the nearest active source block by order; notes do not terminate all later examples. Other quote pairs are nested citations/terms (`「」`), titles (`『』`), Chinese/editorial curly quotes, construction notation (`《》`), and citations (`〈〉`). Quote imbalance is discussed under anomalies.", "",
    "## 9. Headword and reading grammar", "",
    "The strongest explicit heading pattern is `reading［orthography］`, optionally with the source segmentation hyphen `‐`, middle dot `・`, or annotated brackets `⟪...⟫`/`⟨...⟩`. Examples include `いっしょう‐けんめい［一生懸命］`, `あいまい［曖昧］`, and `ひとり‐てんか［⟪一人⟫天下・独り天下］`. The hyphen marks source segmentation and should not survive in a normalized reading. Middle dots may separate alternate spellings inside the orthography field, but they also occur in ordinary text.", "",
    "For 121,757 records the payload starts with `【...】`; the index supplies the only heading. Kana-only records, okurigana forms, mixed orthographies, multiple spellings, and alternative readings occur. `食べる`, `せっかく`, `覚える`, and `おぼえる` are examples with implicit headings. A safe parser distinguishes `IndexKey`, optional `HeadingRaw`, optional `ReadingRaw`, and a list of `OrthographyRaw`; canonical headword selection remains a later validated mapping step.", "",
    "## 10. Special-section grammar", "",
    table(["Marker", "Occurrences", "Entries", "Representative"], [(x["marker"], f'{x["occurrences"]:,}', f'{x["entries"]:,}', (x["examples"][0].get("line", "") if x["examples"] else "")) for x in d["sections"]["inventory"]]), "",
    "`▶` is not one semantic category. Its prose expresses etymology, abbreviation expansion, usage, domain/measure warnings, contrast, and orthographic information. Only four lines literally begin `▶語源`; 22,562 are unlabeled. Keep `▶` as a generic note with raw payload and classify later only when a rule is evidenced.", "",
    "`派生` supports multiple derivatives: 3,390 lines are a single run such as `派生‐さ`; 392 contain multiple separators, for example `派生‐げ／‐さ／‐が・る`. It appears 3,625 times after the last definition, 112 before a definition, and 45 between definitions. Its slash is not a language separator. `表現` appears 1,795 times in 1,545 entries and may contain local `⑴`/`⑵` subdivisions. The requested standalone markers `語源`, `類語`, `対義語`, `参考`, `注意`, `表記`, `用法`, and `語法` have zero standalone line-start occurrences; some occur as `◈` prefixes or inside prose.", "",
    "## 11. Anomaly inventory", "",
    "Byte-level integrity is clean: zero invalid UTF-8, replacement characters, unexpected controls/formats, and strong `Ã…`/`Â…` mojibake signatures. The following are source/conversion structures or punctuation anomalies and must not be silently repaired:", "",
    table(["Pattern", "Occurrences / entries", "Classification"], [(x["token"], f'{x["occurrences"]:,} / {x["entries"]:,}', "custom link metadata" if x["token"] in {"@@@LINK=", "░", "🗏"} else "editorial/conversion notation; preserve raw") for x in d["anomalies"]["artifact_tokens"]]), "",
    f"All 43,095 `@@@LINK` records parse syntactically. Of their targets, {d['links']['counts']['target-in-index']:,} exist and {d['links']['counts']['target-missing']:,} do not. Relation checks yield {d['links']['counts']['headword=target']:,} exact targets, {d['links']['counts']['headword=display']:,} display matches, {d['links']['counts']['headword-in-source-orthography']:,} source-orthography matches, {d['links']['counts']['casefold-target']:,} casefold matches, and **{d['links']['counts']['unexplained-mismatch']:,} unexplained mappings**. Examples include index `&c` encoding target `etching`, `a la mode` encoding `alarm`, and `a posteriori` encoding `apostrophe`. These are recoverable only as raw source records; treating them as trustworthy redirects would corrupt lookup semantics. The 874 plain `→` redirects are more regular: 870 targets exist and four do not.", "",
    "Quote totals and imbalance samples:", "",
    table(["Pair", "Global opens / closes"], [(o+c, f'{quote_counts.get(o,0):,} / {quote_counts.get(c,0):,}') for o,c in {"｢":"｣","「":"」","『":"』","“":"”","‘":"’","《":"》","〈":"〉"}.items()]), "",
    table(["Per-entry imbalance", "Entries", "Example headword"], [(x["pattern"], f'{x["entries"]:,}', x["examples"][0]["headword"]) for x in d["quotes"]["imbalances"][:20]]), "",
    "Bracket totals and the most common per-entry imbalances:", "",
    table(["Pair", "Global opens / closes"], [(o+c, f'{d["brackets"]["character_counts"].get(o,0):,} / {d["brackets"]["character_counts"].get(c,0):,}') for o,c in {"［":"］","【":"】","（":"）","〔":"〕","⟪":"⟫","⟨":"⟩"}.items()]), "",
    table(["Per-entry imbalance", "Entries", "Example headword"], [(x["pattern"], f'{x["entries"]:,}', x["examples"][0]["headword"]) for x in d["brackets"]["imbalances"][:20]]), "",
    "Curly-quote imbalance is systematic in Chinese conversion text, for example `ace` and `basket` use an ASCII opening quote with a curly closing quote. There are also isolated mismatched Japanese closers and bracket imbalances. Rare CJK extension characters, hentaigana, and musical symbols are legitimate notation. `🌸`, `🍀`, `🡺`, `ⓚ`, `▾`, and `▿` appear to be editorial/conversion notation; their semantics require external documentation, so they remain raw. The three-way classification is: legitimate notation (rare characters, music, normal nested quotes); recoverable structure (recognized link wrappers, balanced marker prefixes); ambiguous source data (mismatched links, missing targets, punctuation imbalance, unexplained symbols).", "",
    "## 12. Structural-shape coverage", "",
    "Shape symbols: `H` explicit heading, `P` standalone `【...】`, `D◯` unnumbered definition, `D#` numbered definition, `E` example, `▶` note, `◈...` diamond section, `R` plain redirect, `L` custom link, and `RAW` unclassified physical line.", "",
    table(["Rank", "Shape", "Entries", "%", "Cumulative", "Examples"], shape_rows), "",
    f"There are {d['shapes']['distinct']:,} exact sequences. Top 10 cover {sum(x['entries'] for x in shape_top[:10]) / total:.3%}, top 20 cover {sum(x['entries'] for x in shape_top[:20]) / total:.3%}, top 50 cover {sum(x['entries'] for x in shape_top[:50]) / total:.3%}, and top 100 cover {sum(x['entries'] for x in shape_top[:100]) / total:.3%}. Only {d['shapes']['entries_with_unclassified_lines']:,} entries contain any `RAW` line ({d['shapes']['unclassified_lines']:,} lines). Excluding custom link records, {classified_nonlinks:,}/{nonlinks:,} entries ({classified_nonlinks/nonlinks:.3%}) are completely tokenizable by this small line grammar. This is lexical tokenization coverage, not proof that the same percentage can be safely mapped into canonical senses.", "",
    "## 13. Parser confidence classification", "",
    table(["Field", "Class", "Evidence / required guard"], [
        ("Index key and payload extent", "A — high-confidence deterministic", "Container validation is exact."),
        ("Raw heading presence", "A", "First-line forms and implicit-heading cases are distinguishable."),
        ("Reading / orthography", "B — parseable with validation", "Parse explicit `reading［orthography］`; retain raw and fall back to index key."),
        ("`【...】` labels", "A as raw label; B for interpretation", "Complete-line delimiters are exact; semantics are composite."),
        ("Definition block boundaries", "A as source blocks", "Leading marker inventory is complete."),
        ("Canonical sense boundaries", "B/C", "Restarts, skips, repeats, and mixed marker systems require validation/raw fallback."),
        ("Japanese/Chinese definitions", "B", "Split recognized definition blocks only; retain raw for 496 exceptional lines."),
        ("Examples", "A as raw example lines; B for alignment", "Delimiter is regular; six multi-slash and punctuation anomalies."),
        ("Notes / expression notes", "A as raw blocks; C for semantic subtype", "Position is deterministic; `▶` semantics are heterogeneous."),
        ("Etymology", "C — ambiguous/preserve raw", "Only a small labeled subset; many unlabeled notes are etymological."),
        ("Derivatives", "B", "Marker is stable; multi-item tokenization needs separator-aware validation."),
        ("Custom links", "D — currently unsafe to structure", "31,467 unexplained headword/target mismatches and 240 missing targets."),
    ]), "",
    "## 14. Representative raw entries and interpretation", ""]

    sample_notes = {
        "一生懸命": "Explicit segmented reading and orthography; one composite POS label; one unnumbered bilingual definition; one example.",
        "食べる": "Implicit heading from the index; one POS label; three numbered source blocks; examples and a `表現` block remain attached by order.",
        "曖昧": "Explicit reading/orthography; composite nominal/adjectival label; one definition and multiple examples.",
        "せっかく": "Implicit heading; adverb/noun label; numbered definitions plus a `◈` section that must remain a note block.",
        "覚える": "Implicit heading; numbered definitions and ordered examples. The index spelling is the display candidate.",
        "おぼえる": "A separate index record with the same payload as `覚える`; no duplicate-headword assumption is involved.",
        "a cappella": "One unnumbered definition with an example and a heterogeneous `▶` note.",
        "clear": "Mixed `◯` and numbered source markers; demonstrates why marker blocks are not one monotonic sense list.",
        "あがる": "Many senses and examples; demonstrates ordered block attachment.",
        "あつい": "A derivative section with source morphology notation.",
        "くる": "Unusual conjugation/POS label (`動カ変`).",
        "一人天下": "Unusual explicit heading with segmentation, annotated brackets, and alternate orthography.",
        "ace": "Malformed/mixed quote conversion in Chinese prose; preserve raw punctuation.",
    }
    for word, note in sample_notes.items():
        if selected.get(word):
            parts += [f"### `{word}`", "", note, "", raw_block(selected[word][0]), ""]
    longest = next((x for x in d["longest"] if x["headword"] == "謂ウ"), d["longest"][0])
    parts += ["### One of the longest entries", "", f"`{longest['headword']}` is {longest['bytes']:,} UTF-8 bytes. It exercises many numbered blocks, examples, notes, and subdivisions. The raw record follows in full:", "", raw_block(longest["raw"]), "",
    "## 15. Proposed Meikyo Parser Specification v1", "",
    "```text\nSOURCE STRUCTURE\n  StarDict index key + UTF-8 payload\n  headings / labels / marker-prefixed blocks / examples / notes / links\n        ↓ lossless parse with validation and raw fallbacks\nPARSER AST\n  SourceEntry { indexKey, payloadRaw, nodes[], diagnostics[] }\n  Heading | Label | DefinitionBlock | Example | Note | Expression |\n  Derivative | Redirect | LinkRecord | RawLine\n        ↓ separate, policy-driven canonical mapping\nCANONICAL DICTIONARY MODEL\n  forms/readings/tags/entry definitions/senses/definitions\n  only where the AST evidence satisfies mapping invariants\n```", "",
    "Normative v1 rules:", "",
    "1. Parse StarDict offsets as declared (default 32-bit); reject any out-of-range extent or invalid UTF-8 before entry parsing. Preserve `indexKey`, exact `payloadRaw`, byte offset, size, and ordinal.\n2. Recognize the custom `@@@LINK=░display░【source】🗏page№id[warning]` wrapper and plain `→ target` records before lexical parsing. Store every component and raw text. Do not resolve or canonicalize a link unless its target exists and a documented relationship check passes.\n3. Treat a first complete `【...】` line as a label and use the index key as the implicit heading. Otherwise attempt the explicit `reading［orthography］` grammar. Strip source segmentation only into a derived normalized reading; preserve all bracket and spelling text. If validation fails, emit `Heading(raw=...)` or `RawLine`, never a guessed reading.\n4. Tokenize physical lines in order. Leading `◯` or `①`–`⑳` creates `DefinitionBlock(marker, rawBody)`. Preserve marker sequences exactly, including repeats, skips, restarts, and mixing. Subordinate marker systems become child tokens only when balanced and positionally valid.\n5. Within a recognized definition block, attempt one Japanese/Chinese split. Do not split if empty/multiple slashes or lexical slash notation makes the boundary ambiguous; retain `rawBody` and add a diagnostic. A successful split still retains raw.\n6. A line beginning `｢` becomes `Example(raw, japanese?, chinese?, diagnostics)`. Require a closing delimiter and exactly one validated alignment slash for structured bilingual fields. Attach by source order to the active definition block; retain entry-level position if no active block exists.\n7. Preserve standalone `【...】` as `Label(raw)`. Do not normalize its semantics in parser v1. A later mapping table may interpret known composites.\n8. Preserve `▶` as `Note(kind=unknown, raw)`. Preserve `◈` with optional controlled prefix `{表記,語法,表現,注意,語源}`. Preserve standalone `表現` and `派生`; derivative splitting is optional and validation-gated. Unknown lines always become `RawLine`.\n9. Emit diagnostics for missing link targets, unexplained link relationships, unbalanced punctuation, malformed examples, numbering skips/restarts, and unknown structures. Diagnostics never mutate source text.\n10. Canonical mapping is a separate pass. It may map validated headings/forms/readings and definition blocks, but must not overload canonical definitions with examples, usage notes, etymology, derivatives, or source link metadata. If the current schema cannot represent a concept, retain it in AST/raw audit output and defer import of that concept.", "",
    "The AST should minimally carry source spans or line ordinals so later mapping can preserve ownership. `EntryNote`, `BlockNote`, `Example`, `Etymology`, `Usage`, `Expression`, and `Derivative` are source concepts that the current canonical model may not represent cleanly; they must not be stuffed into definition strings or tags merely to avoid extending a future model.", "",
    "## 16. Unresolved questions", "",
    "- What conversion process produced the 31,467 unexplained custom-link mappings, and is the index key, encoded target, page/id, or an external source table authoritative?\n- What do `🌸`, `🍀`, `ⓚ`, `▾`, `▿`, and `🡺` mean in the conversion vocabulary?\n- Are numbering restarts intended as homographs, grammatical blocks, or editorial groups in every context?\n- Which one-slash Japanese/Chinese pairs that lack kana can be validated linguistically without over-classifying Chinese-only/Japanese-only text?\n- Should explicit alternative spellings inside annotated brackets become independent canonical forms, and how should their reading restrictions be represented?\n- Does a future schema need first-class examples, block-scoped notes, usage, etymology, expression notes, and derivatives before importing those concepts?\n- How should four plain redirects and 240 custom links with missing targets behave?\n- Which punctuation imbalances are faithful source typography versus recoverable conversion errors?", "",
    "## 17. Safety recommendation", "",
    "A deterministic **lossless source parser** is safe: 100% of records decode, 97.850% of non-link entries are fully tokenizable by the small line grammar, and every unknown can fall back to a raw node. A deterministic importer that directly forces every record into canonical senses is not yet safe. The link mismatch population, marker restarts/skips, fragment entries, slash exceptions, and currently unrepresentable examples/notes/derivatives require validation gates and raw preservation. Implement the v1 AST first, measure its diagnostics against this audit, then define a narrower canonical mapping contract. Quarantine or preserve custom link records until their conversion provenance is explained.", "",
    "## Reproduction", "",
    "Files created by this investigation:", "",
    "- `analysis/meikyo_corpus_audit.py` — read-only full-corpus scanner; JSON output was written to `/tmp`.\n- `analysis/render_meikyo_audit.py` — deterministic Markdown renderer.\n- `MEIKYO_PARSER_AUDIT.md` — this report.", "",
    "Commands used:", "",
    "```bash\n/usr/bin/time -v python3 analysis/meikyo_corpus_audit.py '/mnt/c/Users/Administrator/Downloads/sdcv_dictionaries-main/sdcv_dictionaries-main/stardict_明镜日汉双解辞典' --output /tmp/meikyo_audit.json\npython3 analysis/render_meikyo_audit.py /tmp/meikyo_audit.json MEIKYO_PARSER_AUDIT.md\npython3 -m py_compile analysis/meikyo_corpus_audit.py analysis/render_meikyo_audit.py\ngit diff --check\n```", "",
    f"Final scan runtime: {d['runtime_seconds']:.3f} seconds inside the script, 18.40 seconds wall clock under `/usr/bin/time`; peak resident memory 258,864 KiB. Corpus coverage: {d['coverage']['records_decoded']:,}/{d['coverage']['records_total']:,} records (100%). Entries that could not decode: 0. Entries with at least one unclassified physical line: {d['shapes']['entries_with_unclassified_lines']:,}; these are retained as raw nodes rather than discarded."
    ]
    args.output.write_text("\n".join(parts) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

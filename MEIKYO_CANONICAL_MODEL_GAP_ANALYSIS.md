# Meikyo AST → Canonical Dictionary Model Gap Analysis

## Executive decision

Use a **hybrid normalized lexical core plus an optional ordered rich-content layer**, with a separate private source-artifact layer for lossless reprocessing. Keep the existing `DictionaryEntry`, `StructuredEntry`, `Form`, `Sense`, `EntryDefinition`, and `SenseDefinition` behavior intact. Add generic examples and ordered content blocks only when a source has learner content that the normalized core cannot express.

This conclusion follows from three facts in the working implementation:

1. Tomoshi has real entry-level Japanese definitions and real sense-level English/Chinese definitions. The current normalized model represents that ownership correctly and the query DTO preserves it.
2. MDX is intentionally an HTML model. Its raw HTML, sanitized HTML, lazy locator path, stylesheet, resources, and one-hop redirect behavior do not benefit from relationally decomposing its content.
3. Meikyo has 233,554 definition nodes, 203,749 examples, 22,566 notes, 7,240 special sections, 1,795 expression blocks, 3,782 derivative blocks, and 1,413 parsed subdivisions. Their order is meaningful, while `◯`, repeated numbering, skipped numbering, and numbering restarts do not establish canonical `Sense` ownership. A senses-only mapping would invent semantics and lose presentation order.

No schema or production behavior is changed by this document.

## 1. Current canonical model inventory

### `Dictionary`

`Dictionary` owns one immutable imported dictionary snapshot and controls which read path is used.

| Field | Current meaning and scope | Tomoshi | MDX | Safe Meikyo use |
|---|---|---|---|---|
| `id` | Application identity for one dictionary snapshot. Parent of entries and jobs. | Deterministic from source checksum. | Generated when uploaded/imported. | Yes; one ID per imported StarDict snapshot. |
| `name` | User-facing dictionary name. | Option or export-derived default. | MDX filename stem. | Yes, from `.ifo` `bookname` or explicit option. |
| `sourceFilename` | Source filename for identity/display, not a semantic format discriminator. | SQLite filename. | MDX filename. | Yes, likely `.ifo` or package name. |
| `fileChecksum` | Snapshot identity/integrity value. | SQLite SHA-256. | MDX SHA-256. | Yes, but the future importer must define whether this hashes one manifest or all four StarDict files. |
| `storageKey` | Unique logical source location. | Checksum-based logical key; source is read in place. | Stored MDX key. | Yes after a StarDict package-storage policy exists. |
| `status`, `failureSummary`, timestamps, `entryCount` | Import lifecycle and summary. | Used directly. | Used by job/worker. | Yes; importer orchestration can reuse them. |
| `sourceFormat` | Format discriminator independent of language. | `tomoshi`. | Default/explicit `mdx`. | Yes, future value `stardict` or another source-format identifier. It should not be `japanese`. |
| `sourceLanguage`, `targetLanguages` | Dictionary-wide language metadata. | `ja`; targets collected from imported definitions. | Generally unset because HTML is opaque. | Yes when supported by evidence; Meikyo is Japanese with Chinese learner content. |
| `contentModel` | Selects the public HTML or structured query/detail path. | `structured`. | `html`. | Eventually structured/rich, but current enum alone cannot signal availability of ordered rich content. |
| `sourceMetadata` | Dictionary-snapshot metadata and import summary. It is not entry content. | Export versions, licenses, checksum, imported/omitted counts. | Usually null; MDX header has its own field. | Safe for `.ifo`, file hashes, parser version, and aggregate diagnostics. Unsafe for 209,052 per-entry ASTs. |
| MDX fields (`mdxFormatVersion`, `sourceEncoding`, `headerMetadata`, stylesheet/package fields) | MDX/package rendering and lazy-read metadata. | Unused. | Used by import, resources, stylesheet isolation, and lazy detail. | Do not reuse for StarDict or Meikyo concepts. Generic metadata belongs in `sourceMetadata`; package handling needs a separate format-neutral design if required. |

### `DictionaryEntry`

`DictionaryEntry` is the stable application identity shared by search, detail lookup, and `VocabularyItem`. It is also the common search projection for both content models.

| Field | Current meaning and scope | Tomoshi | MDX | Safe Meikyo use |
|---|---|---|---|---|
| `id`, `dictionaryId` | Stable entry identity within a dictionary snapshot. Vocabulary points here. | Deterministic from dictionary/source record. | Generated row identity. | Yes. Preserving this boundary avoids changes to vocabulary ownership. |
| `headwordOriginal` | Canonical display/search headword selected by the importer. | First source-ordered form. | MDX index key. | Conditionally. The audit proves the index key and payload heading can differ; selection needs validated heading rules and raw preservation. |
| `headwordNormalized`, `sortKey` | Derived search/sort values. | Derived from canonical headword. | Derived from index key. | Yes once canonical headword selection is validated. |
| `entryRaw` | Private raw entry body used by MDX reprocessing and parity verification. Never returned publicly. | Null. | Original MDX record, without PostgreSQL-forbidden NUL. | A Meikyo payload could fit technically, but overloading the MDX-oriented field would obscure parser/source-version/diagnostic identity. Prefer a generic source-artifact relation in v2. |
| `entrySanitizedHtml` | Stored safe HTML for `contentModel=html`. | Null. | Required for stored HTML detail and fallback. | No. Meikyo is not HTML. |
| `entryPlainText` | Search preview/vocabulary text, deliberately denormalized. | Forms and imported definitions joined with newlines. | Extracted from sanitized HTML; redirects are empty. | Yes as a derived projection. It must not be the lossless source representation. |
| `entryKind` | Application behavior discriminator: definition, redirect, unknown. | Always definition. | Drives one-hop redirect resolution and HTML rendering. | Normal lexical entries can be definition. Plain `→` records require target validation before redirect behavior. Custom links must not be marked redirect. |
| `redirectTargetOriginal` | Target text for application redirect semantics. | Null. | Parsed MDX target and resolved only within the same dictionary. | Only for validated plain redirects in a later phase. Unsafe for custom links. |
| `sourceOrdinal` | Stable snapshot-local record position and deterministic ordering. | SQLite entry iteration order. | MDX keyword order. | Yes; StarDict index ordinal is exact. |
| `sourceRecordId` | Stable source-assigned ID scoped to a dictionary. | Tomoshi entry ID. | Null. | Possibly null: StarDict supplies an ordinal/index key, not a proven stable source ID. Page/source IDs inside custom links are not entry IDs. |
| MDX locator fields | Exact physical locator for lazy MDX detail, protected by file checksum. | Null. | Used only by MDX services. | No; StarDict offset/size belongs in source-artifact metadata if persisted. Do not fill MDX-named columns. |

### `StructuredEntry`

`StructuredEntry` is a one-to-one capability marker/container attached to `DictionaryEntry`. It owns forms, entry-level definitions, and senses. It contains no semantic fields itself.

- **Tomoshi:** created for every imported entry.
- **MDX:** absent; HTML detail bypasses this graph.
- **Meikyo:** safe as the normalized lexical-core anchor. It is insufficient as the only content representation because it has no heterogeneous ordering or annotations.

### `Form`

| Field | Meaning and scope | Tomoshi | MDX | Safe Meikyo use |
|---|---|---|---|---|
| `structuredEntryId`, `ordinal` | Ordered form membership in one entry. | Preserves source kanji-then-kana order. | Unused. | Yes for validated index/heading orthographies and readings. |
| `text`, `normalizedText`, `language` | Form surface, search key, and language. | Japanese forms searchable through structured search. | Unused. | Yes. |
| `kind` | Source-neutral-ish string currently holding `kanji` or `kana`. | Drives reading selection/rendering. | Unused. | Yes for reliably parsed orthography/readings. Avoid putting heading punctuation or Meikyo marker names here. |
| `tags`, `priorityTags`, `restrictions` | Form-local metadata and reading applicability. | JMdict/Tomoshi info, priority, and kana restrictions. | Unused. | Only when Meikyo evidence establishes equivalent semantics. Heading annotation such as `⟪...⟫` should remain provenance/raw until understood. |

### `Sense`

| Field | Meaning and scope | Tomoshi | MDX | Safe Meikyo use |
|---|---|---|---|---|
| `structuredEntryId`, `ordinal` | Canonical ordered senses within an entry. | One row per actual Tomoshi/JMdict sense. | Unused. | Not derivable from every Meikyo marker. Create only where a later validated grouping rule establishes a semantic sense. |
| `sourceSenseOrdinal` | Snapshot-local source sense position, explicitly not a stable ID. | Mirrors Tomoshi sense ordinal and aligns `zh_defs`. | Unused. | Unsafe to populate from `◯` or circled marker values. A source block ordinal can be preserved elsewhere without calling it a sense. |
| `partOfSpeech`, `domains`, `tags` | Sense-scoped lexical metadata. | Mapped from JMdict `pos`, `field`, and `misc`. | Unused. | Meikyo `【...】` labels are composite and positionally scoped. They can map only after block/sense ownership is established. |
| `notes` | One optional sense-scoped source note string. | Tomoshi sense note. | Unused. | Too narrow for ordered, typed, multilingual, or entry-level Meikyo notes. Do not concatenate `▶`/`◈` into it. |

### `EntryDefinition`

An `EntryDefinition` is an atomic language-specific definition owned directly by an entry. `source` distinguishes providers; `provenance` retains non-public mapping evidence; `ordinal` orders definitions only within the `(entry, language, source)` group.

- **Tomoshi:** Japanese `jpn_defs` rows map here because they are entry-level. Furigana and source row/gloss ordinals are retained in provenance.
- **MDX:** unused.
- **Meikyo:** a Japanese or Chinese definition text can fit here only if entry-level ownership is accepted. The model cannot represent the Japanese/Chinese alignment of one source line, its source marker, its neighboring examples, or order relative to notes and later definitions.

### `SenseDefinition`

A `SenseDefinition` is an atomic language-specific definition owned by one canonical `Sense`. It has the same source/provenance/local-ordinal semantics as `EntryDefinition`.

- **Tomoshi:** English JMdict and Chinese Tomoshi glosses map here. The importer validates Chinese source-sense ordinals instead of guessing.
- **MDX:** unused.
- **Meikyo:** safe only after a source block has been validly mapped to a canonical sense. Numbered markers alone do not satisfy that condition.

### Existing public behavior constrains v2

Structured detail returns forms, then entry definitions, then senses with definitions. It sorts definitions by source, language, and ordinal, not by original heterogeneous source order. The learner renderer separately displays entry definitions and ordered senses. Search considers canonical headword plus `Form`; `entryPlainText` supplies previews. HTML dictionaries retain their existing HTML/lazy paths. Raw content and definition provenance are stored but raw entry content is never exposed by public APIs.

These are sound contracts to preserve while v2 is introduced additively.

## 2. Meikyo AST mapping matrix

Classification: **A** maps cleanly now; **B** needs a source-neutral concept; **C** belongs in private source metadata/fallback; **D** is unresolved or unsafe to canonicalize.

| AST node | Class | Existing safe projection | Gap and decision |
|---|---|---|---|
| `heading` | A + C | Validated headword/readings/orthographies → `DictionaryEntry` and `Form`. | Preserve exact heading, segmentation, annotated brackets, and parsing evidence in the source artifact. Do not promote every bracket component without validation. |
| `grammatical-label` | B/D | None universally safe. Some values could eventually populate `Sense.partOfSpeech`. | Composite POS/transitivity/conjugation labels can scope a following block, multiple blocks, or the entry. Add a generic ordered lexical-label/annotation block; normalize only proven components later. |
| `definition` | B, sometimes A | Language texts may become `EntryDefinition` or `SenseDefinition` after ownership is known. | Needs a multilingual definition block/group retaining alignment, marker provenance, and position. `◯` is not Sense 1; numbering restarts prevent unconditional sense creation. |
| `example` | B | None; Tomoshi examples are currently counted as omitted. | Add generic `Example` plus language-specific `ExampleText`, and place it in ordered content. Ownership must be nullable/validated rather than inferred blindly. |
| `note` (`▶`) | B/D | `Sense.notes` only when proven sense-scoped. | Heterogeneous semantics and scope require a generic annotation/section block with optional semantic kind. Unclassified `▶` remains generic. |
| `special-section` | B | Recognized kinds can use a generic annotation kind: orthography, grammar, expression, caution, etymology. | One generic section/note concept is sufficient; unlabeled content remains kind `other` with source metadata. |
| `expression` | B | None safely. | Generic annotation kind `expression`; position and scope retained. |
| `derivative` | B/C | No existing clean target. | Keep as ordered rich content. Add derivative relations only after targets/forms and semantics can be validated. |
| `subdivision` | B/D | Language text may later project to definitions. | Needs nested ordered blocks. It cannot automatically become a `Sense`; its parent and marker system matter. |
| `redirect` | A/D | `entryKind=redirect`, `redirectTargetOriginal` if validated. | Four audited targets are missing and formatting can differ. Persist raw source artifact regardless; enable redirect behavior only under explicit validation policy. |
| `raw` | C | `entryRaw` demonstrates the private-raw precedent but is MDX-coupled operationally. | Store exact payload/node data and diagnostics in a private source-artifact layer. Do not return it in normal detail. Blank lines may be represented only in source order metadata. |
| `custom-link` | C/D | `DictionaryEntry` identity may be useful for audit/import accounting. | Never map to redirect, alias, form, or relation while 31,467 relationships remain unexplained. Persist its typed source record and raw payload outside canonical relationships. |

## 3. Scope analysis

### Scope vocabulary

The canonical design needs to distinguish:

- **Entry scope:** applies to the lexical entry as a whole.
- **Sense scope:** applies to a proven semantic sense.
- **Definition-block scope:** applies to one source definition/aligned meaning block without asserting it is a canonical sense.
- **Example scope:** the example itself and its aligned texts.
- **Section scope:** a heading/annotation grouping that may contain ordered child blocks.
- **Unknown scope:** position is known; semantic parent is not.

### What source order proves

The AST proves line order and exact node boundaries. A grammatical label before definitions is evidence of proximity, not universally a proven sense relationship. A definition followed by example lines commonly forms a local run, but the audit also found examples after notes and structures with restarts or intervening sections. Therefore “attach every example to the nearest preceding Sense” is unsupported.

The future mapper may use a narrower rule such as “example is a child of the active definition block until a block-boundary token is encountered,” but that rule must first be regression-tested against the corpus. Even then, the owner is a **definition block**, not automatically a canonical `Sense` or one language-specific `Definition` row.

### Specific constructs

| Construct | Deterministic scope | Unsafe assumption |
|---|---|---|
| `▶` | Exact position; raw body. | Entry-level, sense-level, or a single semantic note kind. The audit found etymology, expansion, usage, warnings, contrast, and orthography. |
| `◈表記` | Semantic kind orthography; exact position. | That it modifies only the immediately preceding form or sense. Many lines discuss several senses/forms. |
| `◈語法` | Semantic kind grammar; exact position. | Automatic `Sense.notes` ownership. |
| `◈表現` / standalone `表現` | Semantic kind expression; exact position and subdivisions. | That both markers have identical scope or that all child enumeration maps to senses. |
| `◈注意` | Semantic kind caution; exact position. | That it is a validation error or should change normalized forms. |
| `◈語源` | Semantic kind etymology; normally entry-oriented by meaning. | Resolving named forms/relations or attaching it to the previous sense without evidence. |
| `派生` | A derivative annotation at an exact position. | That each token is a `Form` or resolves to another `DictionaryEntry`. |
| Subdivision | Marker system, position, text, and nesting evidence. | Canonical sense identity. It may subdivide a definition, note, expression section, or grammatical block. |
| Numbering restart | Exact marker sequence and order. | One continuous sense sequence, homograph boundary, or equivalence between repeated `①` blocks. |

The ordered rich-content tree should allow optional `senseId` or `exampleId` links when ownership is proven while remaining valid with entry-only ownership.

## 4. Examples design

A generic example model is justified by both Meikyo and Tomoshi. Meikyo has 203,749 parsed example nodes. Tomoshi Chinese source data already contains examples, but the current importer explicitly counts and omits them because no canonical destination exists. Examples are also a common dictionary concept independent of either source.

Recommended conceptual split:

```text
Example
  id
  structuredEntryId                 required
  senseId                           nullable, only when source proves ownership
  ordinalWithinOwner                optional normalized ordering
  provenance                        private/non-public source mapping evidence

ExampleText
  id
  exampleId
  language                          nullable only for unresolved text
  role                              source | translation | transliteration | other
  text
  ordinal
```

`ExampleText` is preferable to fixed `japaneseText`/`chineseText` columns because it supports monolingual examples, more than one translation, transliteration, future languages, and ambiguous text. For a confidently aligned Meikyo example, create one Japanese source text and one Chinese translation text. For an ambiguous example, keep the full raw node in the source artifact and either omit canonical `ExampleText` or create one language-null `other` text only if that behavior is useful and clearly private.

An example can be:

- entry-level when the source does not establish a narrower owner;
- sense-level when the source provides an explicit sense relationship, as Tomoshi can;
- associated with a definition **block** in rich content when local source structure proves it;
- not safely owned by an individual language-specific definition, because an aligned example illustrates the shared bilingual meaning block rather than only its Japanese or Chinese text.

Global display order comes from `ContentBlock`, not `Example.ordinal`. The example ordinal is useful only within a proven owner and for stable storage.

## 5. Notes and special sections

Do not create separate tables for orthography notes, grammar notes, expression notes, cautions, or etymologies. Their common behavior is ordered explanatory learner content with text, optional kind, optional owner, nesting, and provenance.

Use one generic annotation/section representation with a small source-neutral semantic-kind vocabulary:

```text
annotationKind = usage | expression | grammar | orthography | caution |
                 etymology | derivative | other
```

The value should describe learner semantics, not source glyphs. `▶` itself is stored only in provenance/source artifacts. An unlabeled `◈` or heterogeneous `▶` maps to `other`, unless a separately tested mapper can classify it confidently. Unknown kinds remain valid.

`Sense.notes` remains appropriate for Tomoshi's single, explicitly sense-owned plain note. It need not be removed. New rich notes should not be flattened into that column, and Tomoshi can later project its notes into content blocks if ordered rendering is desired.

Use `section` when a block owns child blocks; use `annotation` for a leaf. Both can share `ContentBlock` storage rather than separate tables.

## 6. Derivatives and relationships

`派生` does not map cleanly to `Form`:

- forms are searchable surface forms of the same lexical entry;
- derivative payloads include morphology such as `‐げ／‐さ／‐が・る` and can contain several items;
- the audit did not prove that each item is a complete headword, the same lexeme, or present as another entry.

It also does not yet justify an entry relation. Resolving by normalized text would recreate the same class of unsafe guess exposed by Meikyo custom links and duplicate headwords.

For v2, represent `派生` as a rich annotation/block with kind `derivative`, ordered raw learner text, and source provenance. A future generic `LexicalRelation` could be justified only when sources provide typed relations with independently validated targets. Such a relation would need `relationKind`, source and target entry/form identities, direction, confidence/provenance, and unresolved-target support. That is outside the next phase.

Tomoshi's `restrictedTo` data remains form applicability, not a derivative relation. Tomoshi currently supplies no canonical entry-to-entry relation that changes this conclusion.

## 7. Ordering analysis

Separate `EntryDefinition`, `Sense`, `Example`, and note tables cannot reconstruct:

```text
definition → example → note → definition → special section → example
```

Table-local ordinals only order homogeneous siblings. Querying and concatenating each table imposes an application-created hierarchy, as the current structured detail does for Tomoshi. That is correct for Tomoshi's known ownership but insufficient for Meikyo.

Add an entry-wide ordered block sequence with optional nesting:

```text
ContentBlock
  id
  structuredEntryId
  parentBlockId?          nested subdivision/section
  senseId?                only when proven
  exampleId?              for an example reference
  kind                    definition | example | annotation | section |
                          lexicalLabel | derivative | raw
  semanticKind?           usage, grammar, orthography, ...
  ordinal                 among siblings
  sourceNodeOrdinal?      private provenance, not semantic order
```

For definition content, a block owns ordered `ContentText` rows rather than referencing one language-specific definition. That preserves Japanese/Chinese alignment. The importer may additionally populate existing `EntryDefinition`/`SenseDefinition` rows as normalized search/query projections when ownership is safe.

This is source-neutral: other dictionaries can order definitions, examples, labels, panels, and notes without adopting Meikyo glyphs. MDX does not need blocks because its HTML already supplies an ordered document representation.

## 8. Raw fallback strategy

Losslessness and canonical rendering are separate responsibilities. Introduce a private source-artifact boundary conceptually:

```text
EntrySourceArtifact
  entryId
  parserName
  parserVersion
  sourceFormatVersion?
  sourceLocator             JSON: StarDict ordinal/offset/size, or future equivalent
  rawPayload                text or bytes according to format contract
  parsedAst                 JSON, versioned and optional
  diagnostics               JSON
  astSchemaVersion
  contentChecksum
```

This data must not appear in normal search/detail DTOs. It supports:

- exact source reparse and parser-version migrations;
- verification that imported canonical projections came from the expected payload;
- preservation of 4,777 currently unknown lines and 2,244 blank-line nodes;
- original marker sequences, line endings, nested markers, and ambiguous alignments;
- audit and quarantine without inventing learner-facing semantics.

Storing only serialized AST JSON is insufficient because parsers evolve. Store the raw payload as the authority and treat AST/diagnostics as a versioned cache. Storing every entry artifact in `Dictionary.sourceMetadata` is inappropriate because it would create one huge dictionary row and prevent entry-local reprocessing.

The existing MDX `entryRaw` demonstrates the privacy and reprocessing principle. Migration should not immediately move MDX data: the new artifact can initially serve Meikyo only, then MDX may adopt it in a later compatibility migration if that reduces duplication without disrupting lazy locators.

## 9. Custom-link strategy

All 43,095 custom-link records parse structurally, but 31,467 have unexplained index-headword/target relationships and 240 targets are absent. The safe persistence boundary is a source artifact or quarantined source record, not a canonical redirect.

If every StarDict record must receive an application identity for accounting, a future importer may create a `DictionaryEntry` with:

- the index headword preserved;
- `entryKind=unknown`;
- empty or diagnostic-derived private plain text;
- a linked `EntrySourceArtifact` containing typed custom-link fields and the raw payload;
- no `redirectTargetOriginal`, `Form`, `Sense`, or entry relation.

Whether these rows should be publicly searchable is unresolved and must be a later product/query decision. Alternatively, keep them in a source-record table outside `DictionaryEntry` until their semantics are understood. The second option is semantically safer; the first makes record counts and reprocessing easier. Neither option should silently activate redirect behavior.

## 10. Design alternatives

| Criterion | A. Extend normalized schema | B. Generic ordered blocks only | C. Hybrid core + ordered blocks |
|---|---|---|---|
| Semantic correctness | Good for forms and proven senses; poor when forced to represent unknown scope. | Preserves source documents well but weakens lexical meaning and search invariants. | Strong: normalize only proven concepts and preserve the rest in order. |
| Query complexity | Simple for existing DTOs; becomes complex/nullable for every new content type. | One recursive/block query but every consumer must interpret blocks. | Existing queries stay stable; rich detail adds one optional ordered query. |
| Rendering complexity | Separate arrays lose interleaving; renderer must guess order. | Generic renderer is straightforward but source-neutral semantics may be too loose. | Existing Tomoshi renderer remains; rich renderer consumes ordered blocks when present. |
| Tomoshi compatibility | Good initially, but examples/notes require more tables and cross-ordering remains absent. | Requires rewriting Tomoshi immediately. | Additive; Tomoshi can adopt examples/blocks incrementally. |
| MDX compatibility | Neutral if left untouched. | Poor incentive: translating HTML into blocks would duplicate a document model. | Excellent: MDX remains HTML; block capability is optional. |
| Future sources | Accumulates tables and ownership columns; hard to express new document structures. | Highly flexible but risks becoming untyped JSON in rows. | Stable lexical core plus bounded block kinds/texts handles both query and display. |
| Source ordering | Cannot preserve heterogeneous order without another mechanism. | Native. | Native for rich sources. |
| Losslessness | Requires raw sidecar anyway. | Still requires raw sidecar for parser evolution. | Explicit source-artifact layer. |
| Migration cost | Moderate schema change, high semantic risk. | High: query/API/frontend rewrite. | Moderate additive migration; old behavior remains valid. |

**Recommendation: C.** It makes rich content a capability rather than replacing the working HTML and normalized models. It also avoids treating an ordered source document as a bag of canonical senses.

## 11. Recommended canonical model v2

Conceptual schema only:

```text
CORE LEXICAL DATA

Dictionary
└── DictionaryEntry                       stable search/vocabulary identity
    └── StructuredEntry?                  normalized lexical capability
        ├── Form[]
        ├── EntryDefinition[]             atomic entry-owned definitions
        └── Sense[]
            └── SenseDefinition[]         atomic sense-owned definitions

RICH LEARNER CONTENT (optional capability)

StructuredEntry
├── Example[]
│   └── ExampleText[]                     language + role + text + ordinal
└── ContentBlock[]                        entry-wide ordered forest
    ├── parentBlock? / childBlocks[]
    ├── sense?                            only when ownership is proven
    ├── example?                          typed reference for example blocks
    ├── kind                              definition/example/annotation/section/
    │                                     lexicalLabel/derivative/raw
    ├── semanticKind?                     usage/expression/grammar/orthography/
    │                                     caution/etymology/derivative/other
    ├── ordinal                           sibling order
    └── ContentText[]                     language?, role, text, ordinal

SOURCE-SPECIFIC FALLBACK (private)

DictionaryEntry or source record
└── EntrySourceArtifact
    ├── rawPayload
    ├── sourceLocator
    ├── parsedAst + astSchemaVersion
    ├── diagnostics
    ├── parser identity
    └── content checksum
```

### Definition duplication policy

The normalized definitions and rich definition blocks serve different contracts:

- normalized definitions support semantic ownership and current APIs;
- rich definition blocks preserve alignment and document order.

Where both are created, the importer must generate them from the same AST node in one transaction and record a private source-node key/provenance. Do not let application edits independently mutate one projection. A future unification into `DefinitionGroup`/`DefinitionText` could remove duplication, but that would require rewriting the stable Tomoshi query contract and is larger than necessary now.

### Capability selection

Do not add a new top-level `contentModel` value merely because blocks exist. Conceptually, a structured entry may have normalized content, rich ordered content, or both. A later API can return an optional `contentBlocks` field or introduce a versioned rich-detail endpoint while preserving current structured DTOs.

## 12. Proposed conceptual relationships

| Relationship | Cardinality | Constraint |
|---|---|---|
| Dictionary → DictionaryEntry | 1:N | Existing cascade and snapshot scope. |
| DictionaryEntry → StructuredEntry | 1:0..1 | Existing capability anchor. |
| StructuredEntry → ContentBlock | 1:N | Unique `(entry, parent, ordinal)` ordering; root parent is null. |
| ContentBlock → ContentBlock | 1:N | Optional parent; parent must belong to same entry; cycles prohibited. |
| StructuredEntry → Example | 1:N | Entry ownership always present. |
| Sense → Example | 1:N optional | `senseId` nullable and must belong to same structured entry. |
| Example → ExampleText | 1:N | Unique role/language/ordinal policy; at least one text. |
| ContentBlock → Example | 0..1:0..1 | Required when `kind=example`; database/application check. |
| ContentBlock → Sense | N:0..1 | Optional proven scope; never inferred from marker alone. |
| ContentBlock → ContentText | 1:N | Used for definition and explanatory blocks; typed roles. |
| DictionaryEntry → EntrySourceArtifact | 1:0..N | Allows parser versions or multiple source components; active artifact uniquely identified by parser/version policy. |

Cross-table invariants such as “referenced sense belongs to the same entry” may require compound keys or transactional application validation if Prisma cannot express them directly. Prefer database checks where practical, but do not compromise the model with polymorphic unvalidated IDs.

## 13. Incremental migration plan

1. **Add private source artifacts first.** Add an entry-local, versioned artifact table and retain current `entryRaw`. No query/API changes. Test exact Meikyo payload round trips and parser-version reprocessing.
2. **Add generic examples.** Add `Example` and `ExampleText` without exposing them. Extend Tomoshi import tests to show its currently omitted examples can be stored losslessly; decide ownership from explicit Tomoshi sense keys.
3. **Add ordered rich blocks.** Add `ContentBlock` and `ContentText` with entry ownership, optional parent/sense/example links, sibling ordinal constraints, and source-neutral kinds. Keep current DTOs unchanged.
4. **Implement Meikyo mapping as a dry-run projector.** Produce candidate `DictionaryEntry`, forms, normalized definitions where safe, examples, blocks, and artifacts. Compare counts/checksums without database writes before creating `MeikyoImporter`.
5. **Resolve entry policy.** Decide canonical headword precedence, plain redirects, custom-link quarantine, grammatical block-to-sense rules, and which ambiguous definitions remain rich-only.
6. **Implement transactional MeikyoImporter.** Select by source format/structure, not language. Persist core, rich, and source-artifact projections atomically. Preserve source ordinal and deterministic IDs.
7. **Add an opt-in rich-detail read path.** Existing Oxford/MDX and Tomoshi DTOs remain unchanged. Add rich blocks only after importer parity and rendering tests exist.
8. **Optionally enrich Tomoshi.** Import its examples and project sense notes/content into blocks without changing existing `Sense`/definition ownership or IDs.
9. **Consider MDX artifact convergence separately.** Only after proving that moving/copying `entryRaw` does not break reprocessing, locators, shadow verification, resources, or one-hop redirects.

Throughout, preserve existing `DictionaryEntry.id`; `VocabularyItem.entryId` therefore needs no rewrite. All migrations should be additive and non-destructive until the new read path has parity coverage.

## 14. Unresolved questions

1. What exact rule establishes a Meikyo grammatical block, and when does such a block qualify as a canonical `Sense`?
2. Does an example run terminate at notes/sections, a new definition marker, a grammatical label, or only an explicit block boundary?
3. Which Japanese/Chinese single-slash alignments are strong enough for canonical `ContentText` rows rather than raw-only preservation?
4. Should a definition block with no proven sense create entry-level normalized definitions, or remain rich-only until scope is established?
5. Are `◈表記` and other annotations entry-wide in all cases, or can source rules establish form/block scope?
6. What is the precise grammar and target semantics of `派生` items?
7. What generated the 31,467 unexplained custom-link relationships, and should custom-link records ever become public entries?
8. Should plain redirects with missing targets be visible as unresolved redirect entries or quarantined source records?
9. What is the StarDict package identity/checksum/storage contract across `.ifo`, `.idx`, `.idx.oft`, and `.dict.dz`?
10. Should rich content be returned as an optional extension of the current structured DTO or through a versioned detail representation?
11. Is storing the complete AST JSON worth the storage cost, or are raw payload plus parser identity/diagnostics sufficient for deterministic regeneration?

## 15. Things we should not model yet

- Do not model `◯` as Sense 1.
- Do not model circled numbers as canonical sense IDs or require monotonic numbering.
- Do not turn numbering restarts into homographs without evidence.
- Do not attach every example to the nearest `Sense`.
- Do not map custom links to redirects, aliases, forms, or lexical relations.
- Do not resolve derivatives to entries or treat every derivative token as a form.
- Do not translate every `【...】` label into canonical POS/conjugation fields yet.
- Do not create one table per `◈` category or per Meikyo marker.
- Do not expose raw payload, AST, diagnostics, offsets, source IDs, or provenance in normal public DTOs.
- Do not convert MDX HTML into content blocks.
- Do not replace Tomoshi entry/sense definition ownership with a flattened block document.
- Do not overload `Dictionary.sourceMetadata` with entry-level ASTs.
- Do not reuse MDX locator columns for StarDict offsets.
- Do not add Meikyo-named columns, enums, or tables to the canonical layer.
- Do not delete or repurpose `entryRaw`, `Sense.notes`, or existing definition tables during the additive v2 introduction.

## Final impact summary

### Recommended architecture

Retain the normalized lexical core, add optional generic examples and ordered rich-content blocks, and store exact source artifacts privately. A future Meikyo mapper chooses what enters each layer; parsing does not imply canonicalization.

### New generic concepts required

- `Example`
- `ExampleText`
- `ContentBlock`
- `ContentText`
- `EntrySourceArtifact`
- a small source-neutral content/annotation-kind vocabulary

### Concepts requiring no schema change

- Dictionary snapshot identity and format discrimination
- Entry identity, source ordinal, headword search fields, and plain-text projection
- Validated forms/readings
- Proven canonical senses
- Entry-level and sense-level atomic definitions
- Existing Tomoshi sense metadata
- Existing MDX HTML, resource, stylesheet, redirect, and lazy-locator behavior

### Intentionally source-specific

- Raw marker glyphs and marker sequences
- StarDict byte offsets/sizes and container metadata
- Custom-link target/display/source/page/source-ID/warning fields
- Exact heading punctuation and unexplained annotations
- Parser diagnostics and ambiguous alignment evidence
- Unknown/raw nodes and blank-line preservation

### Compatibility

- **Tomoshi:** no existing row or DTO must change. It can later store its currently omitted examples and optionally project content into blocks. Its entry-level Japanese and sense-level English/Chinese ownership remains authoritative.
- **MDX/Oxford:** no behavior change. HTML remains the ordered representation; current stylesheet/resource/audio/internal-link and lazy-detail paths remain untouched.

### Likely Prisma work in the next phase

The next phase would likely add models equivalent to `EntrySourceArtifact`, `Example`, `ExampleText`, `ContentBlock`, and `ContentText`, plus relations from `StructuredEntry` and optional relations to `Sense`. It would need ordinal/ownership indexes, cascade rules, source-artifact version/checksum uniqueness, and database/application invariants for block kind and same-entry ownership. Those changes should be additive; no existing columns need removal or semantic repurposing.

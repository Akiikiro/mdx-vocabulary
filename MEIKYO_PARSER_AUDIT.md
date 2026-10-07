# Meikyo Parser Audit

> Scope: read-only, full-corpus structural audit of **明镜日汉双解辞典**. No source bytes, production code, schema, importer, API, query, or frontend files were changed. Counts below come from all 209,052 index records, not a sample.

## 1. StarDict container validation

The `.ifo` declares `wordcount=209052`, `idxfilesize=4293917`, and `sametypesequence=m`. It has no `idxoffsetbits`, so StarDict's default 32-bit big-endian offset applies. Lowercase `m` is a UTF-8 plain-text payload. The `.idx` size matches the declaration exactly.

| Check | Result |
|---|---|
| Index records | 209,052 |
| Unique headwords | 209,052 |
| Duplicate records/headwords | 0 / 0 |
| Index bytes consumed | 4,293,917 of 4,293,917 |
| Decompressed payload | 53,664,545 bytes |
| Maximum resolved end | 53,664,545 (exact payload end) |
| Invalid offsets / sizes | 0 / 0 |
| UTF-8 failures / zero lengths | 0 / 0 |
| Entry bytes min / median / max | 10 / 188.0 / 16,527 |
| Entry bytes mean | 256.704 |
| `.idx.oft` | 6,534 values; 0 mismatches against every 32nd record start plus EOF |

All index extents resolve within the decompressed payload. They are unique, ordered, non-overlapping, contiguous, and end exactly at byte 53,664,545. `.idx.oft` begins with `StarDict's Cache, Version: 0.2`, followed by four opaque bytes (`c1d1a451`) and a valid little-endian cache table.

File fingerprints:

| File | Bytes | SHA-256 |
|---|---|---|
| 明镜日汉双解辞典.ifo | 142 | `97929463a66b52373334c903c0326e911268b1212d090876f20dcb12f443a93a` |
| 明镜日汉双解辞典.idx | 4,293,917 | `39a33fd281d1c34bae0e98d1f8ace1222c6def0ca21a8bf0606e570bab0851cc` |
| 明镜日汉双解辞典.idx.oft | 26,170 | `6e5ebb224045c9ed009fb4a169063077b31cb8b15ddbb2c8cf07325941c041b4` |
| 明镜日汉双解辞典.dict.dz | 18,777,726 | `019d674e79cc92c26b4d3ef42342227d8ce378dcc6ac195587d708d954946f56` |

## 2. Corpus statistics

The scan decoded 209,052/209,052 records (100%). There are no duplicate index headwords, but that does not make the payload uniform: 43,095 records are custom link records, 874 are plain redirects, 121,757 begin directly with a `【...】` label, and 43,326 have some other explicit first line.

| Payload start / heading pattern | Entries | Examples |
|---|---|---|
| implicit-index-heading | 121,757 | a cappella; a la carte; ABC |
| link-record | 43,095 | &c; a la mode; a posteriori |
| explicit+reading-orthography+hyphen | 27,332 | 一一; 一丁; 一丁前 |
| explicit+reading-orthography | 11,323 | ください; クダサイ; 一 |
| explicit+plain | 4,039 | あいそもこそもつきはてる; あうはわかれのはじめ; あおはあいよりいでてあいよりあおし |
| plain-redirect | 874 | about; account; algorithm |
| explicit+reading-orthography+hyphen+middle-dot | 388 | 一人天下; 一人相撲; 一人舞台 |
| explicit+plain+middle-dot | 186 | あとがない; いざというとき; いざという時 |
| explicit+reading-orthography+middle-dot | 58 | 世; 並; 二月 |

The index headword is therefore authoritative as an index key only. It cannot universally be reused as a parsed display heading, and the payload's first line cannot universally be treated as a heading.

## 3. Complete marker inventory

| Marker | Structural line starts | All text occurrences | Entries with structural use |
|---|---|---|---|
| ◯ | 120,012 | 120,036 | 118,129 |
| ① | 44,254 | 44,254 | 42,966 |
| ② | 43,995 | 43,995 | 42,721 |
| ③ | 12,551 | 12,551 | 12,133 |
| ④ | 4,622 | 4,622 | 4,492 |
| ⑤ | 2,231 | 2,231 | 2,176 |
| ⑥ | 1,357 | 1,357 | 1,328 |
| ⑦ | 932 | 932 | 908 |
| ⑧ | 704 | 704 | 684 |
| ⑨ | 577 | 577 | 559 |
| ⑩ | 469 | 469 | 452 |
| ⑪ | 327 | 327 | 327 |
| ⑫ | 288 | 288 | 288 |
| ⑬ | 221 | 221 | 221 |
| ⑭ | 189 | 189 | 189 |
| ⑮ | 175 | 175 | 175 |
| ⑯ | 155 | 155 | 155 |
| ⑰ | 149 | 149 | 149 |
| ⑱ | 131 | 131 | 131 |
| ⑲ | 113 | 113 | 113 |
| ⑳ | 102 | 102 | 102 |

Structural counts require the marker to be the first character of a nonempty physical line. The all-text column is an exhaustiveness check: extra occurrences are quotations, cross-references, or inline subdivisions and are not silently promoted to definition boundaries.

There are 419 distinct complete primary-marker sequences. `◯` occurs in entries with a single unnumbered block, but it is not a single-sense guarantee: `◯◯` occurs in 1,437 entries, and `◯` coexists with numbered markers in 2,217. Numbered markers repeat in 1,171 entries, skip a number in 482, and restart or decrease in 1,171. Repeats often delimit a new grammatical/homograph block, but sometimes restart without an explicit separator. Skips are genuine source patterns. The source grammar must preserve the observed sequence instead of validating it as one monotonic sense list.

Most common complete sequences:

| Sequence | Entries | Examples |
|---|---|---|
| ◯ | 114,392 | a cappella, a la carte, ABC |
| none | 48,718 | &c, a la mode, a posteriori |
| ①② | 28,482 | acacia, academism, access |
| ①②③ | 6,596 | album, anchor, ballade |
| ①②③④ | 1,862 | ace, arch, band |
| ◯◯ | 1,437 | aloha, bio, centi |
| ① | 1,290 | blue, click, compact |
| ② | 960 | freeze, hold up, jumbo |
| ①②③④⑤ | 628 | block, home, hood |
| ①②◯ | 571 | comic, hard, あきる |
| ◯①② | 389 | あるいは, いれちがう, いれ違う |
| ①②③④⑤⑥ | 259 | corner, cup, field |
| ①②③◯ | 219 | あいさつ, いきおい, おいで |
| ①②①② | 197 | sharp, あさる, うん |
| ②③ | 182 | relay, repeat, shortcut |
| ◯①②③ | 165 | お, くだ, くりこむ |
| ①②③④⑤⑥⑦ | 160 | double, line, あそぶ |
| ③ | 101 | charge, goal, いっかくじゅう |
| ①②③①② | 97 | いくら, おし, かまえる |
| ①②③④◯ | 92 | clear, いっぽう, うちかえす |
| ①③ | 91 | format, short, いしき |
| ①②③④⑤⑥⑦⑧⑨ | 85 | あさい, あたま, かしら |
| ◯◯◯ | 78 | no, いどむ, おやすみ |
| ①②③④⑤⑥⑦⑧⑨⑩ | 72 | いたる, うごく, うち |
| ①②③④⑤◯ | 63 | あお, いちだん, かえる |
| ①②③④⑤⑥⑦⑧ | 62 | あかるい, あたえる, きまる |
| ①②④ | 57 | pool, spin, あらう |
| ①②①②③ | 54 | つっぱる, つっ張る, セイ |
| ③④ | 49 | cut, play, service |
| ◯①②③④ | 47 | soft, あらそう, さま |
| ①②③④⑤⑥◯ | 41 | いう, おれる, かぶる |
| ①◯ | 38 | くたびれる, じねん, ぜひ |
| ①②①②③④ | 35 | かぎる, こつ, こむ |
| ①②③④①② | 33 | おに, ぎん, すかす |
| ①②③④⑤⑥⑦⑧⑨⑩⑪ | 30 | うつる, おもて, かるい |
| ①②③①②③ | 30 | くっする, つの, カク |
| ①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳ | 28 | いれる, おちる, はいる |
| ①②◯◯ | 28 | つけ, ツケ, 人気 |
| ①②③④⑤⑥①②③ | 25 | あう, はずす, むける |
| ◯① | 24 | おもいつく, おもい付く, ばんざい |

Other marker systems occur inside blocks:

| System | Occurrences | Entries | Example |
|---|---|---|---|
| circled-katakana | 1,446 | 367 | ㋐首から上の部分。かしら。こうべ。/头，头部。脖子以上部分。｢深々と~を下げる/深深地低头｣｢~を横に振る/摇头｣ |
| parenthesized-unicode | 348 | 155 | 表現⑴「ご」「お」をつけて、謙遜の気持ちを添える。「ご~に一曲歌いましょう」⑵「愛嬌がある／愛想がよい」はともに相手を評価して言うが、前者は個人の顔立ちや性向が自然に備わったものとして言い、後者は対人関係のあり方として個人の社会的（または人為的）側面に注目して言う。「愛嬌／愛想 を振りまく」でも、後者には、無理をして、こびてなどといった人為的な趣が感じられる。 |
| ascii-parentheses | 3,835 | 1,768 | ◈「アクチブ」とも。[1][2](1)⇔パッシブ |
| square-brackets | 797 | 396 | ◈「アクチブ」とも。[1][2](1)⇔パッシブ |

These systems can be nested on the same physical line. They are source-local subdivisions, enumeration, or explanatory structure; none is safe to flatten into top-level canonical senses without contextual validation.

## 4. Complete `【...】` inventory

Exactly 92 distinct values occur as a complete line. The notation includes POS, transitivity, conjugation class, classical inflection, syntactic subtype, and composites. It is not a POS-only field.

| Raw value | Occurrences | Representative headwords |
|---|---|---|
| `【名】` | 103,684 | a cappella, a la carte, ABC |
| `【名・自サ変】` | 8,781 | access, bivouac, bound |
| `【名・他サ変】` | 8,635 | air check, assist, blend |
| `【他五】` | 7,410 | 〆切る, 〆切ル, あおる |
| `【自五】` | 6,187 | あいしあう, あいし合う, あいつぐ |
| `【名・形動】` | 4,830 | artistic, cheap, dandy |
| `【他下一】` | 4,710 | 〆る, 〆ル, あえる |
| `【副】` | 2,381 | just, 〆て, 〆テ |
| `【形】` | 2,344 | あいくるしい, あいらしい, あえない |
| `【造】` | 2,291 | chemical, giga, nano |
| `【自下一】` | 1,992 | あぐねる, あけくれる, あけはなれる |
| `【形動】` | 1,769 | active, all-round, at home |
| `【名・自他サ変】` | 1,644 | Americanize, comment, miss |
| `【連語】` | 1,303 | あえず, あかず, あきたりない |
| `【形動トタル】` | 649 | あいあい, あいまいもこ, あぜん |
| `【他サ変】` | 471 | あいする, あっする, あんずる |
| `【動五】` | 377 | あう, あがる, あさる |
| `【副ト】` | 369 | あくせく, あたふた, あっさり |
| `【自上一】` | 359 | あぶらじみる, あぶら染みる, あまんじる |
| `【連体】` | 341 | あくなき, あくる, あく無き |
| `【自サ変】` | 320 | あいたいする, あいなかばする, あい半ばする |
| `【代】` | 290 | あいつ, あそこ, あたい |
| `【接】` | 250 | あるいは, おまけに, および |
| `【動下一】` | 160 | あげる, あわせる, おえる |
| `【他上一】` | 155 | あびる, いいすぎる, いい過ぎる |
| `【自他五】` | 154 | いいあらそう, いい争う, いきがる |
| `【名・副】` | 151 | あまた, ありのまま, ありの儘 |
| `【感】` | 122 | adieu, aloha, bonjour |
| `【副ニ】` | 108 | あながち, いっこう, おもいおもい |
| `【接頭】` | 105 | anti-, self, semi |
| `【自他下一】` | 90 | あかせる, いただける, いれあげる |
| `【自他サ変】` | 81 | えきする, かする, がっする |
| `【接尾】` | 68 | がる, ぐむ, ごと |
| `【名・自サ変・形動】` | 45 | うわき, おおもて, おお持て |
| `【名・形動・自サ変】` | 39 | おうちゃく, かんしん, きょうつう |
| `【動上一】` | 33 | あきる, おる, すぎる |
| `【自他上一】` | 33 | きょうじる, こんじる, しょうじる |
| `【副・形動】` | 27 | あいにく, あんがい, いかが |
| `【名・形動トタル】` | 27 | かんかんがくがく, くうばく, ここ |
| `【形動・副】` | 23 | いっしょうけんめい, じゅうぶん, ぞんぶん |
| `【副トニ】` | 19 | おいおい, おい追い, じじこっこく |
| `【自四】` | 19 | おめく, こととう, こと問う |
| `【他四】` | 17 | いだす, だす, のたまう |
| `【形ク】` | 14 | かそけし, さやけし, はるけし |
| `【副・形動トタル】` | 14 | こうぜん, だんこ, とつじょ |
| `【感・形動】` | 14 | ごくろうさま, ごちそうさま, はばかりさま |
| `【動サ変】` | 13 | おわす, する, そんずる |
| `【自ラ変】` | 12 | あり, しかり, アリ |
| `【自下二】` | 12 | ありうる, あり得る, いず |
| `【助動　形型】` | 10 | ごとし, べし, まほし |
| `【他下二】` | 8 | うれう, ウレウ, 告ぐ |
| `【名・形動・他サ変】` | 8 | かんよう, せんだん, カンヤク |
| `【形動ナリ】` | 8 | たえ, ひじり, タエ |
| `【副・形動ナリ】` | 7 | うべ, むべ, ウベ |
| `【動特活】` | 7 | ござんす, ごわす, ゴザンス |
| `【名・形動トタル・自サ変】` | 7 | はんぜん, ほうふつ, ハンゼン |
| `【形シク】` | 6 | いまだし, イマダシ, 悪し |
| `【動四】` | 6 | おわします, オワシマス, 在します |
| `【終助】` | 6 | がな, げな, ぞ |
| `【副・名】` | 5 | yes, これから, コレカラ |
| `【形・補形】` | 5 | いい, 佳い, 善イ |
| `【自ナ変】` | 5 | イヌ, 去ぬ, 去ヌ |
| `【動下二】` | 5 | ウル, エル, 得る |
| `【副・接】` | 4 | かくして, カクシテ, 斯くして |
| `【接・副】` | 4 | かくて, カクテ, 斯くて |
| `【接助】` | 4 | けに, たりとも, ところを |
| `【名・副ト】` | 4 | こくこく, こっこく, コクコク |
| `【他】` | 4 | なさい, ナサイ, 為さい |
| `【自カ変】` | 4 | やってくる, やって来る, ヤッテクル |
| `【名・形動ナリ】` | 3 | いってい, イッテイ, 一定 |
| `【名・副トニ】` | 3 | かくだん, カクダン, 格段 |
| `【名・他サ変・形動】` | 3 | けんやく, ケンヤク, 倹約 |
| `【名・自他サ変・形動トタル】` | 3 | けんれん, ケンレン, 眷恋 |
| `【副助】` | 3 | だけ, っきり, どころ |
| `【名・自サ変・形動トタル】` | 3 | どうじゃく, ドウジャク, 瞠若 |
| `【接助・終助・接】` | 2 | けど, けれど |
| `【助動　特活型】` | 2 | ざんす, です |
| `【助動　五型】` | 2 | じまう, じゃう |
| `【形動トタル・副】` | 2 | イゼン, 依然 |
| `【助動　四型】` | 2 | ソロ, 候 |
| `【名・他五】` | 2 | 付説, 附説 |
| `【名・形動・形動トタル】` | 2 | 恬淡, 恬澹 |
| `【動カ変】` | 1 | くる |
| `【補動五】` | 1 | けつかる |
| `【副助・終助】` | 1 | ったら |
| `【格助】` | 1 | って |
| `【接・連語】` | 1 | とすれば |
| `【助動　ラ変型】` | 1 | めり |
| `【助動　下二型】` | 1 | る |
| `【代・名・形動】` | 1 | 彼方此方 |
| `【名・形動トタル・他サ変】` | 1 | 整斉 |
| `【形動・形動トタル】` | 1 | 閑散 |

## 5. Complete `◈` inventory

| Label after `◈` | Occurrences | Entries | Representative line |
|---|---|---|---|
| (unlabeled) | 4,616 | 4,524 | ◈接近方法の意。 |
| 表記 | 2,165 | 2,164 | ◈表記「羅▾甸」「▾拉丁」などとも。 |
| 語法 | 218 | 208 | ◈語法口頭語の言い切りでは「愛している」となることが多い。「愛しない・愛しよう・愛せよ」とサ変にも活用するが、今では「愛さない・愛そう・愛せ」のように五段化する傾向が強い。文あい・す（サ変）異形愛す |
| 表現 | 199 | 190 | ◈表現(1)は「あそこ」「あれ」より丁寧な言い方。くだけた言い方では「あっち」となる。 |
| 注意 | 26 | 26 | ◈注意「味あい」は誤り。⇨味わう |
| 語源 | 16 | 16 | ◈語源「挨」は押す、「拶」は迫る意。もと禅宗で問答をして相手の修行の程度を試すこと。 |

The complete controlled prefix set is `表記`, `語法`, `表現`, `注意`, and `語源`. “(unlabeled)” means the prose starts immediately after `◈`; it is not an undiscovered label. A single line may concatenate further tokens such as `表記`, `文`, or `名`, so the safe AST stores the raw line and an optional recognized prefix.

## 6. Definition and sense grammar

A common lexical block is an optional explicit heading, one or more standalone `【...】` labels, then definition lines beginning with `◯` or `①`–`⑳`. Example, note, expression, and derivative lines can follow a definition. A new label or a numbering restart may begin another grammatical block. Some entries omit a heading, label, or definition entirely; some idiom fragments begin directly with definition/example prose.

`◯` denotes an unnumbered definition block, not necessarily an entry with exactly one semantic sense. Circled numbers are ordered source blocks, but repetition, restart, skip, and mixed `◯`/numbered sequences prove that a parser must retain the marker token and block position. Circled katakana, parenthesized Unicode numbers, ASCII `(n)`, and `[n]` form subordinate systems. Proposed AST names them `DefinitionBlock` and `Subdivision` rather than prematurely asserting canonical `Sense`.

## 7. Japanese/Chinese alignment

| Line class | Slash shape | Lines | Entries | Representative raw line |
|---|---|---|---|---|
| definition | obvious-ja-zh | 222,566 | 156,698 | ◯楽器の伴奏を伴わない合唱曲（の様式）。/无伴奏合唱。没有乐器伴奏的合唱曲（合唱形式）。 |
| definition | one-ambiguous | 10,492 | 8,405 | ④「サービスエース」の略。/"サービスエース”的略语。 |
| definition | right-only | 235 | 228 | ◯/催促。 |
| definition | multiple | 160 | 151 | ◯光度を表す単位。周波数五四〇テラヘルツの単色放射を放出し、所定の方向におけるその強度が六八三分の一ワット毎ステラジアンである光源の、その方向における光度。記号cd/坎德拉。表示发光强度的单位。发出频率为540×10¹²赫兹的单色光，并在规定方向上的强度为1/683瓦特每球面度的光源在该方向上的发光强度为1坎德拉，符号为cd |
| definition | none | 101 | 101 |  |
| example | obvious-ja-zh | 170,846 | 80,374 | ｢~で歌う/ⓚ用无伴奏合唱唱歌｣ |
| example | one-ambiguous | 32,897 | 22,677 | ｢卒業記念~/毕业纪念集｣ |
| example | multiple | 6 | 6 | ｢~文化［政党］/ⓚ年轻文化［青年政党］/｣ |
| other | none | 284,720 | 0 |  |
| other | multiple | 1,652 | 430 | DOS/V @@@LINK=░ドスブイ░【DOS/V】🗏2107№40326 |
| other | obvious-ja-zh | 1,024 | 331 | ◈骸骨の意。外観の色が淡く半透明で、骸骨のように内部の構造が見えるものの意でも使う。｢~カラー/ⓚ骨架色，透明色｣ |
| other | one-ambiguous | 376 | 236 | ▶basic input/output systemの略。 |

For definition lines, 222,566 have exactly one slash and an obvious kana-bearing Japanese left side with a Han-bearing right side. Another 10,492 one-slash lines are structurally consistent but cannot be proven by script alone because Japanese can contain only kanji/katakana. There are 235 right-only definitions, 101 definitions with no slash, and 160 with multiple slashes. Multiple slashes include units and ratios such as `c/s`, `1/100`, and `1/683`; elsewhere slash separates derivatives or occurs in link text. Therefore only a block-specific split rule is safe: for a recognized definition/example line, split at a validated boundary and preserve the unsplit raw text; never globally split `/`.

## 8. Example grammar

There are 203,749 physical example lines. Every recognized example line begins with `｢`; the corpus contains 206,875 `｢` and 206,875 `｣` characters overall because some lines contain nested or multiple quoted units. Recognized lines have 170,846 obvious one-slash Japanese/Chinese pairs, 32,897 structurally paired but script-ambiguous lines, and six multi-slash anomalies. No recognized example line lacks a slash.

| Examples per entry | Entries |
|---|---|
| 0 | 115,520 |
| 1 | 55,194 |
| 2 | 21,171 |
| 3 | 7,135 |
| 4 | 3,213 |
| 5 | 1,650 |
| 6 | 1,251 |
| 7 | 809 |
| 8 | 604 |
| 9 | 408 |
| 10 | 345 |
| 11 | 234 |
| 12 | 210 |
| 13 | 176 |
| 14 | 161 |
| 16+ (long tail) | 872 |

Examples occur before a note marker 187,133 times and after one 16,616 times. Thus examples attach to the nearest active source block by order; notes do not terminate all later examples. Other quote pairs are nested citations/terms (`「」`), titles (`『』`), Chinese/editorial curly quotes, construction notation (`《》`), and citations (`〈〉`). Quote imbalance is discussed under anomalies.

## 9. Headword and reading grammar

The strongest explicit heading pattern is `reading［orthography］`, optionally with the source segmentation hyphen `‐`, middle dot `・`, or annotated brackets `⟪...⟫`/`⟨...⟩`. Examples include `いっしょう‐けんめい［一生懸命］`, `あいまい［曖昧］`, and `ひとり‐てんか［⟪一人⟫天下・独り天下］`. The hyphen marks source segmentation and should not survive in a normalized reading. Middle dots may separate alternate spellings inside the orthography field, but they also occur in ordinary text.

For 121,757 records the payload starts with `【...】`; the index supplies the only heading. Kana-only records, okurigana forms, mixed orthographies, multiple spellings, and alternative readings occur. `食べる`, `せっかく`, `覚える`, and `おぼえる` are examples with implicit headings. A safe parser distinguishes `IndexKey`, optional `HeadingRaw`, optional `ReadingRaw`, and a list of `OrthographyRaw`; canonical headword selection remains a later validated mapping step.

## 10. Special-section grammar

| Marker | Occurrences | Entries | Representative |
|---|---|---|---|
| ▶ | 22,566 | 21,584 |  |
| 派生 | 3,782 | 3,779 | 派生‐さ |
| 表現 | 1,795 | 1,545 | 表現末期状態の物事を回復させる効果的な措置の意でも使う。 |

`▶` is not one semantic category. Its prose expresses etymology, abbreviation expansion, usage, domain/measure warnings, contrast, and orthographic information. Only four lines literally begin `▶語源`; 22,562 are unlabeled. Keep `▶` as a generic note with raw payload and classify later only when a rule is evidenced.

`派生` supports multiple derivatives: 3,390 lines are a single run such as `派生‐さ`; 392 contain multiple separators, for example `派生‐げ／‐さ／‐が・る`. It appears 3,625 times after the last definition, 112 before a definition, and 45 between definitions. Its slash is not a language separator. `表現` appears 1,795 times in 1,545 entries and may contain local `⑴`/`⑵` subdivisions. The requested standalone markers `語源`, `類語`, `対義語`, `参考`, `注意`, `表記`, `用法`, and `語法` have zero standalone line-start occurrences; some occur as `◈` prefixes or inside prose.

## 11. Anomaly inventory

Byte-level integrity is clean: zero invalid UTF-8, replacement characters, unexpected controls/formats, and strong `Ã…`/`Â…` mojibake signatures. The following are source/conversion structures or punctuation anomalies and must not be silently repaired:

| Pattern | Occurrences / entries | Classification |
|---|---|---|
| ░ | 86,190 / 43,095 | custom link metadata |
| @@@LINK= | 43,095 / 43,095 | custom link metadata |
| 🗏 | 43,095 / 43,095 | custom link metadata |
| ⓚ | 3,249 / 2,610 | editorial/conversion notation; preserve raw |
| ▿ | 751 / 486 | editorial/conversion notation; preserve raw |
| ▾ | 508 / 378 | editorial/conversion notation; preserve raw |
| 🡺 | 263 / 96 | editorial/conversion notation; preserve raw |
| ⚠️ | 153 / 153 | editorial/conversion notation; preserve raw |
| 🌸 | 18 / 18 | editorial/conversion notation; preserve raw |
| 🍀 | 18 / 18 | editorial/conversion notation; preserve raw |

All 43,095 `@@@LINK` records parse syntactically. Of their targets, 42,855 exist and 240 do not. Relation checks yield 3,825 exact targets, 3,751 display matches, 4,039 source-orthography matches, 13 casefold matches, and **31,467 unexplained mappings**. Examples include index `&c` encoding target `etching`, `a la mode` encoding `alarm`, and `a posteriori` encoding `apostrophe`. These are recoverable only as raw source records; treating them as trustworthy redirects would corrupt lookup semantics. The 874 plain `→` redirects are more regular: 870 targets exist and four do not.

Quote totals and imbalance samples:

| Pair | Global opens / closes |
|---|---|
| ｢｣ | 206,875 / 206,875 |
| 「」 | 40,902 / 40,900 |
| 『』 | 1,119 / 1,144 |
| “” | 15,042 / 15,386 |
| ‘’ | 9 / 9 |
| 《》 | 6,684 / 6,691 |
| 〈〉 | 1,783 / 1,783 |

| Per-entry imbalance | Entries | Example headword |
|---|---|---|
| “”: 0/1 | 128 | basket |
| “”: 3/4 | 55 | かくれる |
| “”: 1/2 | 53 | ace |
| “”: 2/3 | 34 | あし |
| “”: 1/0 | 30 | DM |
| “”: 4/5 | 22 | つっこむ |
| 『』: 0/1 | 15 | いろ |
| “”: 7/8 | 14 | とうご |
| “”: 7/5 | 10 | あてる |
| “”: 17/19 | 8 | おいで |
| 《》: 1/2 | 8 | おとぎぞうし |
| “”: 1/3 | 8 | おる |
| “”: 2/4 | 7 | かわる |
| 「」: 1/0 | 7 | きりょ |
| “”: 3/5 | 7 | ござんす |
| 「」: 9/8 | 7 | カケル |
| “”: 6/7 | 6 | あたる |
| “”: 8/7 | 6 | いただく |
| “”: 2/1 | 6 | しょうぐん |
| 『』: 1/2 | 6 | でかける |

Bracket totals and the most common per-entry imbalances:

| Pair | Global opens / closes |
|---|---|
| ［］ | 60,999 / 60,999 |
| 【】 | 206,958 / 206,959 |
| （） | 59,141 / 59,217 |
| 〔〕 | 2,300 / 2,366 |
| ⟪⟫ | 245 / 245 |
| ⟨⟩ | 399 / 399 |

| Per-entry imbalance | Entries | Example headword |
|---|---|---|
| 〔〕: 1/2 | 64 | うちだす |
| （）: 0/1 | 47 | gain |
| （）: 1/2 | 36 | きゅうくつ |
| （）: 2/1 | 33 | くんそく |
| （）: 4/5 | 15 | deposit |
| （）: 1/0 | 14 | ぎんす |
| （）: 3/4 | 11 | apostrophe |
| （）: 2/3 | 11 | しんれい |
| （）: 7/8 | 8 | しかたない |
| （）: 4/3 | 8 | しっぷう |
| （）: 29/30 | 7 | くる |
| 〔〕: 3/4 | 7 | はなせる |
| 〔〕: 2/1 | 7 | やすむ |
| （）: 7/5 | 4 | あるいは |
| （）: 5/4 | 4 | くたびれる |
| 〔〕: 2/3 | 4 | はしっこ |
| （）: 3/2 | 3 | くうせき |
| （）: 33/34 | 3 | ところ |
| （）: 14/15 | 3 | のち |
| 〔〕: 1/0 | 2 | 剪刀 |

Curly-quote imbalance is systematic in Chinese conversion text, for example `ace` and `basket` use an ASCII opening quote with a curly closing quote. There are also isolated mismatched Japanese closers and bracket imbalances. Rare CJK extension characters, hentaigana, and musical symbols are legitimate notation. `🌸`, `🍀`, `🡺`, `ⓚ`, `▾`, and `▿` appear to be editorial/conversion notation; their semantics require external documentation, so they remain raw. The three-way classification is: legitimate notation (rare characters, music, normal nested quotes); recoverable structure (recognized link wrappers, balanced marker prefixes); ambiguous source data (mismatched links, missing targets, punctuation imbalance, unexplained symbols).

## 12. Structural-shape coverage

Shape symbols: `H` explicit heading, `P` standalone `【...】`, `D◯` unnumbered definition, `D#` numbered definition, `E` example, `▶` note, `◈...` diamond section, `R` plain redirect, `L` custom link, and `RAW` unclassified physical line.

| Rank | Shape | Entries | % | Cumulative | Examples |
|---|---|---|---|---|---|
| 1 | `L` | 43095 | 20.614% | 20.614% | &c, a la mode, a posteriori |
| 2 | `P D◯` | 35667 | 17.061% | 37.676% | acetone, adieu, adult children |
| 3 | `P D◯ E` | 27240 | 13.030% | 50.706% | accident, all-night, all-round |
| 4 | `H P D◯` | 13002 | 6.220% | 56.926% | 一中節, 一人天下, 一人相撲 |
| 5 | `H P D◯ E` | 8859 | 4.238% | 61.163% | 一下, 一丸, 一事 |
| 6 | `P D◯ ▶` | 5822 | 2.785% | 63.948% | a la carte, absinthe, achievement test |
| 7 | `P D◯ E×2` | 5817 | 2.783% | 66.731% | analog, auction, batting |
| 8 | `P D# E D# E` | 5220 | 2.497% | 69.228% | auto, avec, boat |
| 9 | `P D#×2` | 4816 | 2.304% | 71.531% | academism, acryl, aftercare |
| 10 | `P D◯ E ▶` | 3292 | 1.575% | 73.106% | a cappella, AO, asparagus |
| 11 | `P D#×2 E` | 2928 | 1.401% | 74.507% | animal, aria, barytone |
| 12 | `H P D◯ E×2` | 2085 | 0.997% | 75.504% | 一体化, 一利, 一同 |
| 13 | `H P D◯ ▶` | 2075 | 0.993% | 76.497% | 一八, 一向宗, 一周忌 |
| 14 | `H` | 1986 | 0.950% | 77.447% | あうはわかれのはじめ, あきなすはよめにくわすな, あきのひはつるべおとし |
| 15 | `H P D#×2` | 1540 | 0.737% | 78.183% | 一夫, 一季, 一寸 |
| 16 | `P D# E D#` | 1537 | 0.735% | 78.919% | address, agent, angle |
| 17 | `P D◯ E 派生` | 1181 | 0.565% | 79.484% | deluxe, elegant, fuzzy |
| 18 | `P E` | 1167 | 0.558% | 80.042% | high-tech, あかりさき, あかり先 |
| 19 | `H E` | 1117 | 0.534% | 80.576% | あさのごとし, あしがつく, あしがでる |
| 20 | `H P D◯ E ▶` | 1044 | 0.499% | 81.076% | 一丁字, 一介, 一倡三歎 |
| 21 | `P D# E D# E D# E` | 1029 | 0.492% | 81.568% | group, station, あしあと |
| 22 | `R` | 874 | 0.418% | 81.986% | about, account, algorithm |
| 23 | `P D◯ E×2 ▶` | 827 | 0.396% | 82.381% | ABC, air pocket, bird |
| 24 | `P D# E×2 D# E` | 819 | 0.392% | 82.773% | big, business, curve |
| 25 | `H P D# E D# E` | 787 | 0.376% | 83.150% | 一命, 一品, 一帯 |
| 26 | `H P D#×2 E` | 783 | 0.375% | 83.524% | 一人舞台, 一人芝居, 一六勝負 |
| 27 | `P D◯ E×3` | 672 | 0.321% | 83.846% | just, live, miss |
| 28 | `P D#×3` | 666 | 0.319% | 84.164% | anchor, ballade, basket |
| 29 | `P D# E D# E×2` | 654 | 0.313% | 84.477% | Kapsel, 〆切る, 〆切ル |
| 30 | `P` | 633 | 0.303% | 84.780% | あかせる, あんおん, あんじょ |
| 31 | `P D#×2 ▶` | 510 | 0.244% | 85.024% | acacia, arabesque, crust |
| 32 | `H P E` | 502 | 0.240% | 85.264% | 一丁前, 一己, 一擲 |
| 33 | `P D◯ E×2 派生` | 484 | 0.232% | 85.495% | simple, あつぼったい, あぶなっかしい |
| 34 | `H P D# E D#` | 473 | 0.226% | 85.722% | 一例, 一夕, 一子 |
| 35 | `P D# E D# E ◈raw` | 460 | 0.220% | 85.942% | film, hair, holder |
| 36 | `H ▶` | 459 | 0.220% | 86.161% | あいそもこそもつきはてる, あおはあいよりいでてあいよりあおし, あけてくやしいたまてばこ |
| 37 | `P D#×2 ◈raw` | 395 | 0.189% | 86.350% | access, bloomers, flea market |
| 38 | `P D#` | 392 | 0.188% | 86.538% | freeze, hold up, rendez-vous |
| 39 | `P ▶` | 391 | 0.187% | 86.725% | diamant, Eskimo, あおあらし |
| 40 | `P D# ▶ D#` | 334 | 0.160% | 86.885% | bishop, buckskin, bungalow |
| 41 | `P E ▶` | 326 | 0.156% | 87.041% | GI, あかし, あぐむ |
| 42 | `H P D◯ E 派生` | 292 | 0.140% | 87.180% | 下劣, 不勉強, 不合理 |
| 43 | `P D# E×2 D# E D# E` | 280 | 0.134% | 87.314% | oil, あっぱく, あらわ |
| 44 | `P D# E D# E 派生` | 277 | 0.133% | 87.447% | smart, あまずっぱい, あま酸っぱい |
| 45 | `H P D◯ E×3` | 271 | 0.130% | 87.576% | 一式, 一徹, 一掃 |
| 46 | `P E×2` | 270 | 0.129% | 87.705% | あさいち, あぶらじみる, あぶら染みる |
| 47 | `H P D◯ E×2 ▶` | 248 | 0.119% | 87.824% | 一昼夜, 一晩, 一望 |
| 48 | `P D#×2 E D# E` | 245 | 0.117% | 87.941% | album, ensemble, shock |
| 49 | `P D# E×2 D# E×2` | 234 | 0.112% | 88.053% | class, あかす, あゆみ |
| 50 | `P D# E` | 232 | 0.111% | 88.164% | charge, compact, cross |

There are 3,950 exact sequences. Top 10 cover 73.106%, top 20 cover 81.076%, top 50 cover 88.164%, and top 100 cover 91.398%. Only 3,568 entries contain any `RAW` line (6,190 lines). Excluding custom link records, 162,389/165,957 entries (97.850%) are completely tokenizable by this small line grammar. This is lexical tokenization coverage, not proof that the same percentage can be safely mapped into canonical senses.

## 13. Parser confidence classification

| Field | Class | Evidence / required guard |
|---|---|---|
| Index key and payload extent | A — high-confidence deterministic | Container validation is exact. |
| Raw heading presence | A | First-line forms and implicit-heading cases are distinguishable. |
| Reading / orthography | B — parseable with validation | Parse explicit `reading［orthography］`; retain raw and fall back to index key. |
| `【...】` labels | A as raw label; B for interpretation | Complete-line delimiters are exact; semantics are composite. |
| Definition block boundaries | A as source blocks | Leading marker inventory is complete. |
| Canonical sense boundaries | B/C | Restarts, skips, repeats, and mixed marker systems require validation/raw fallback. |
| Japanese/Chinese definitions | B | Split recognized definition blocks only; retain raw for 496 exceptional lines. |
| Examples | A as raw example lines; B for alignment | Delimiter is regular; six multi-slash and punctuation anomalies. |
| Notes / expression notes | A as raw blocks; C for semantic subtype | Position is deterministic; `▶` semantics are heterogeneous. |
| Etymology | C — ambiguous/preserve raw | Only a small labeled subset; many unlabeled notes are etymological. |
| Derivatives | B | Marker is stable; multi-item tokenization needs separator-aware validation. |
| Custom links | D — currently unsafe to structure | 31,467 unexplained headword/target mismatches and 240 missing targets. |

## 14. Representative raw entries and interpretation

### `一生懸命`

Explicit segmented reading and orthography; one composite POS label; one unnumbered bilingual definition; one example.

```text
いっしょう‐けんめい［一生懸命］
【形動・副】
◯全力を尽くして物事をするさま。懸命。一所懸命。/拼命，拼命地。尽全力完成一件事。
｢~な姿が心を打つ/被他拼命的样子打动了｣
｢~に努力する/拼命地努力｣
｢~働く/拼命地工作｣
▶「一所懸命」から出た語。今では「一所懸命」より一般的。
派生‐さ
```

### `食べる`

Implicit heading from the index; one POS label; three numbered source blocks; examples and a `表現` block remain attached by order.

```text
【他下一】
①固形の食物をかんで飲み込む。/吃。咀嚼固体的食物并咽下。
｢毎朝七時に朝ごはんを~/每天早上7点吃早饭｣
｢うちの犬はご飯も味噌汁も~/我家的狗米饭和酱汤都吃｣
｢彼は肉は~が魚は~・べない/他吃肉不吃鱼｣
｢何か腹の足しになるものを~・べたい/想吃点可以果腹的东西｣
表現⑴「食う」の丁寧語として使われてきたが、「食う」が粗野な感じを伴うようになり、「食べる」が一般的な言い方になってきている。⑵尊敬表現には「召し上がる」「お召し上がりになる」「お食べになる」のほか、「上がる」「お上がりになる」がある。「食べられる」は尊敬よりは可能の意で使うことが多い。また、乱暴な言い方に「食らう」が、文章語的な言い方に「食する」がある。
②生活する。食う。/生活。吃。
｢月給だけでは~・べていけない/只靠月薪没法生活｣
```

### `曖昧`

Explicit reading/orthography; composite nominal/adjectival label; one definition and multiple examples.

```text
あいまい［曖昧］
【形動】
◯物事がはっきりしないさま。不明瞭。あやふや。/暧昧，不清楚，含糊。
｢態度が~だ/态度暧昧｣
｢~な表現/暧昧的表达｣
◯表向きとは違って、いかがわしいこと。/可疑的。表里不一。
｢~茶屋（＝料理屋などを装って娼婦を置いた店）/可疑的小店（＝以店铺为幌子，实际从事卖淫活动的店）｣
▶他の語と複合して使う。
```

### `せっかく`

Implicit heading; adverb/noun label; numbered definitions plus a `◈` section that must remain a note block.

```text
【名・副】
◯ある物事や行為が、大きな価値をもっているという話し手の気持ちを、その価値が有効に生かされたかどうかの観点からいう語。/特意，好不容易。费力。表达说话人心情的词语。即讲话人认为某一事物或者行为具有重大价值，而其价值是否得到了充分利用。
｢a ~の御厚意ですからお受けしましょう/盛情难却，我们接受吧｣
｢b これでは~の景観が台無しだ/这样，好端端的风景都糟蹋了｣
｢c ~帰郷したのだから、しばらく滞在なさい/好不容易回家乡一次，待几天吧｣
｢d ~おいで頂いたのに何のもてなしもできません/好容易请您来了，什么都没能招待｣
｢e ~ですから、頂戴致します/承蒙特意准备，那我就收下了｣
｢f ~だが先約がある/对不起，不能接您的邀请，我已经有约了｣
表現その価値が有効に生かされる場合は、原因・理由を説明する順接表現となり（ace）、生かされなかった場合は、多く無念や遺憾などの気持ちを暗示する逆接表現となる（bdf）。
｢~御静養なさるが可でしょう〈藤村〉/可以充分疗养嘛｣
◈語源朱雲が五鹿に住む充宗を論争で破ったことを「鹿の角を折る」と評したという中国の故事に基づく（「折角」が本来的表記で、「切角」は当て字）。古くは、骨を折る（＝苦労する）意で使った。
```

### `覚える`

Implicit heading; numbered definitions and ordered examples. The index spelling is the display candidate.

```text
【他下一】
①記憶にとどめる。記憶する。/记住，记得。记忆。
｢相手の名前と顔を~/记得对方的名字和长相｣
｢あの時のことは今でもよく~・えている/当时的情景仍记忆犹新｣
｢この本を彼に返すことを~・えておいてね/记住把这本书还给他噢｣
｢〔捨てぜりふで〕ようく~・えておけ（＝仕返しは覚悟しておけ）/你给我好好记着（＝我会找你算账的）｣
②学んで身につける。体得する。/学会，掌握。体会。
｢運転を~/学会驾驶｣
｢コツを体で~/通过实践，掌握要领｣
｢酒の味を~（＝知る）/领会（＝知道）酒的味道｣
｢犬が芸を~/狗学会表演技能｣
③ある感情や感覚を感じる。/感觉，感到。感觉到某种情感或感觉等。
｢新しい仕事に生きがい［とまどい］を~/对新工作感到很有意义［迷茫］｣
｢親しみ［怒り・興味・のどの渇き］を~/感到亲切［愤怒・有兴趣・口渴］｣
◈語源「おもほゆ🡺おぼほゆ🡺おぼゆ🡺おぼえる」と転じた。文おぼ・ゆ（下二）名覚え
```

### `おぼえる`

A separate index record with the same payload as `覚える`; no duplicate-headword assumption is involved.

```text
【他下一】
①記憶にとどめる。記憶する。/记住，记得。记忆。
｢相手の名前と顔を~/记得对方的名字和长相｣
｢あの時のことは今でもよく~・えている/当时的情景仍记忆犹新｣
｢この本を彼に返すことを~・えておいてね/记住把这本书还给他噢｣
｢〔捨てぜりふで〕ようく~・えておけ（＝仕返しは覚悟しておけ）/你给我好好记着（＝我会找你算账的）｣
②学んで身につける。体得する。/学会，掌握。体会。
｢運転を~/学会驾驶｣
｢コツを体で~/通过实践，掌握要领｣
｢酒の味を~（＝知る）/领会（＝知道）酒的味道｣
｢犬が芸を~/狗学会表演技能｣
③ある感情や感覚を感じる。/感觉，感到。感觉到某种情感或感觉等。
｢新しい仕事に生きがい［とまどい］を~/对新工作感到很有意义［迷茫］｣
｢親しみ［怒り・興味・のどの渇き］を~/感到亲切［愤怒・有兴趣・口渴］｣
◈語源「おもほゆ🡺おぼほゆ🡺おぼゆ🡺おぼえる」と転じた。文おぼ・ゆ（下二）名覚え
```

### `a cappella`

One unnumbered definition with an example and a heterogeneous `▶` note.

```text
【名】
◯楽器の伴奏を伴わない合唱曲（の様式）。/无伴奏合唱。没有乐器伴奏的合唱曲（合唱形式）。
｢~で歌う/ⓚ用无伴奏合唱唱歌｣
▶原義は、礼拝堂風にの意。一般に、無伴奏での意に転用する。
```

### `clear`

Mixed `◯` and numbered source markers; demonstrates why marker blocks are not one monotonic sense list.

```text
【名・他サ変】
①棒高跳び・走り高跳びなどで、バーを落とさずに跳び越すこと。/跨过，越过。撑竿跳或助跑跳高等，身体不碰竿地越过去。
｢一・五㍍を一回で~する/1.5米一次跳过｣
②障害や困難を乗り越えること。/排除障碍，克服困难。
｢条件［規制の数値］を~する/排除条件［限制的数值］｣
③サッカーで、守備側がボールをけり出して失点を防ぐこと。/解围。足球比赛中，守门员把球踢出去，防止失分。
④不要なものを、すっかり取り除くこと。/彻底清除无需之物。
｢入力したデータを~する/清除以前的数据｣
◯明るく、はっきりしているさま。明晰なさま。/清晰的，清楚的样子。明晰的样子。
｢~な画像［頭脳］/清晰的图像［头脑］｣
派生‐さ
◈「クリアー」「クリヤー」とも。
```

### `あがる`

Many senses and examples; demonstrates ordered block attachment.

```text
【動五】
｢エレベーターで一階から六階 に／へ~/坐电梯从一层上到六层｣
｢階段を~/上台阶｣
｢空高くひばりが揚がる/云雀飞向高空｣
｢丘の上に駆け~/跑上山丘｣
表現「上る（登る・昇る）」は「山道を走って登る」のように経過（経由点）に注目して、「上がる」は本来一気に高くなる意で、「はしごを上って屋根に~」など、高くなった結果（到着点）に注目していうことが多い。
｢怒るとすぐに手が~/一发火就举手（打人）｣
｢『賛成！』と、勢いよく手が挙がる/高高地举起手喊道“同意！”｣
｢先輩に頭が~・らない/在前辈面前抬不起头｣
｢熱気球が空中を~・ってゆく/热气球向高空升去｣
｢炎［噴煙・花火］が~/火苗［烟雾・焰火］升腾｣
｢凧が揚がる/风筝升空｣
｢幕［軍配・遮断機］が~/大幕揭开了［相扑中举起判定胜负的扇子・拉起断路器］｣
｢右の肩が少し~・っている/右肩稍稍偏高｣
｢海兵隊が上陸用舟艇で岸に~/海军陆战队乘坐登陆艇登上海岸｣
｢風呂から~/洗完澡｣
｢今日はマダイが五匹~・った/今天捕获了五条加级鱼｣
｢沈没船から金銀財宝が~/从沉船上打捞到金银财宝｣
｢座敷に~・って待つ/上到客厅等候｣
｢教室内には土足で~な/不得穿鞋进入教室内｣
｢妓楼に~/登入青楼｣
｢舞台［土俵・リング］に~/登上舞台［相扑台・拳击场］｣
｢今すぐお宅にお届けに~・ります/马上送到您府上｣
｢先斗町を少し~・った所/从先斗町稍微往北的地方｣
▶御所が町の北部にあったことから。
｢初段から二段に~/从（围棋）一段升到二段｣
｢六歳で小学校に~/六岁就升入小学了｣
｢投票率が五㌫~/投票率提高了百分之五｣
｢気温が~/气温升高｣
｢質［評価］が~/质量［评价］提升｣
｢スピードが~/速度提高了｣
｢物価［基本給］が~/物价［基本工资］上涨｣
｢有力候補として三人の名前が~・っている/作为有竞争力的候选人，三个人榜上有名｣
｢証拠が~/出现证据｣
｢非難のやりだまに~/成为谴责的対象｣
｢毎月アパートから家賃が~/每月都能从出租的公寓获得房租｣
｢利益［効果］が~/收到效益［效果］｣
｢歓声［悲鳴］が~/响起欢呼声［哀叫］｣
｢あちこちで不満の声が~/四处响起了不满的声音｣
｢気勢が~/气势壮大｣
｢犯人が~/犯人被拘留了｣
｢人前に出ると~/一站到人前就紧张｣
｢エビがからりと~/虾炸得松脆｣
｢天ぷらが~/虾炸好了｣
｢お供え［線香］が~/供奉供品［香火］｣
｢お屋敷に~/在府第内侍奉｣
｢新進作曲家として名が~/作为新的作曲家成名｣
｢一夜にして文名が~/一夜之间在文坛上出了名｣
｢夕立［梅雨・生理］が~/阵雨［梅雨・月经］停了｣
｢脈が~（＝絶命する）/脉搏停止跳动（＝死亡）｣
｢仕事が~・ったら映画に行こう/下班后去看电影吧｣
｢染め物がきれいに~/染布染好了，非常漂亮｣
｢一年がかりでやっと初級が~・った/花了一年时间，总算学完了初级｣
｢引っ越しは五万円で~・った/搬家只花了五万日元｣
｢真っ先に~/最早和牌｣
｢赤潮で魚介が~/赤潮造成了鱼类贝类的死亡｣
▶魚が死んで浮かび上がってくることから。
｢水死体が~/水尸漂上来｣
｢車のバッテリーが~/汽车电池没电了｣
｢たんと~・ってください/请您多吃点儿｣
《動詞の連用形に付いて複合動詞を作る》/（接动词连用形后构成复合动词）
｢でき~・焼き~・編み~/做好・烧好・编好｣
｢震え~・のぼせ~・縮み~/颤抖不已・头昏眼花・缩成一团｣
｢晴れ~・干~/万里晴空・晒干｣
◈[1](2)(4)(5)(12)(14)(15)(22)(23)⇔下がる[1](1)(2)(4)⇔下りる[1](1)⇔下る表記「上」は広く一般に、「挙」ははっきりと目立つように示す意で、「揚」は（するすると）高く掲げる、（ふわふわと）浮かべる、陸上に移すなどの意味合いで使う。「騰」は値段が高くなる意で好まれるが、やや特殊。他動詞「あげる」の場合も同じ。可能上がれる「やっとのことで一軍に上がれた」名上がり
```

### `あつい`

A derivative section with source morphology notation.

```text
【形】
◯気温や体全体で感じる温度が、適温より高いと感じる。/热，炎热。气温以及全身感到的温度超过了合适温度。
｢暖房がききすぎて~/暖气开得太热｣
｢夏は~/夏天很热｣
｢~国に生まれる/出生于炎热的国度｣
｢風呂上がりなので（私は）暑い/ⓚ刚洗完澡，所以（我）很热｣
｢一走りしたので体が熱い・日差しを浴びて背中が熱い・興奮して顔が熱い/ⓚ跑了一圈，身体很热・沐浴在阳光下后背热热的・兴奋得脸都热了｣
▶「熱い」と同語源。
派生‐げ／‐さ／‐が・る
```

### `くる`

Unusual conjugation/POS label (`動カ変`).

```text
【動カ変】
①ある場所からこちらに、近づくように動く。/来，到来。从某一个地方向这里（说话人的方向）靠近。
｢多数の留学生が世界各地から日本に来ている/大多数留学生从世界各地来到日本｣
｢北海道から来た山田です/我）是从北海道来的山田｣
｢あ、電車が来た/啊，电车来了｣
②《動詞の連用形または動作性の漢語名詞＋「に~」の形で》あることをするためにこちらへ移動する。/（以动词连用形或带有动作性的汉语名词＋“に~”的形式）为做某事（实现某个目的）而来。为了做某件事而来到这里。
｢当地へは祭りを見に来た/来到当地是为了看节日庆祝活动｣
｢彼は君の所へ相談（し）に来たんだ/他是有事跟你商量才来你那儿的｣
③組織の一員として新しく加わる。/加入。作为组织的新成员加入。
｢営業部に新入社員が来た/营业部来了新职员｣
④ものが、運ばれたり通信手段に乗ったりしてこちらに届く。/送来，传到。物品被送来或是通过通信手段到达此处。
｢手紙［連絡］が~/来信了［联系上了］｣
｢依頼が~/委托来了｣
⑤差し向けられた動作（の影響）がこちらに届く。また、差し向けられた動作に対するお返しがこちらに戻る。/被实施的动作（的影响）来到这里。或指对被实施的动作采取的行动返回这里。
｢強烈なパンチが顔面に~/猛烈的一拳打在脸上｣
｢反撃が~/反击来了｣
｢千円からおつりが~/一千日元找回的零钱｣
⑥台風や波などの自然現象がこちらに移動する。/台风等自然现象移动。台风及波涛等自然现象向这里移动。
｢台風が~/台风来了｣
｢大きな波が~/汹涌的波涛来了｣
⑦地震や雨・風などの自然現象が起こる。/地震、雨、风等自然现象发生。
｢地震が来ても慌てないことだ/即使发生地震也不要慌张｣
｢一雨来そうな空模様だ/天空呈现出要下雨的样子｣
⑧時間が経過して、季節・時期・順番などがこちらに近づく。/时间、季节等临近。随着时间的流逝，季节、时间、顺序等临近。
｢新年［春・別れの時］が~/新年［春天・分别的时刻］到来了｣
｢君の番が来たら声をかける/轮到你的时候我叫你｣
⑨敷設物などがこちらに通じる。/施工设施等开通了。施工设施等通到这里。开通。
｢ガスが~/通煤气了｣
｢わが家にはまだ大容量回線が来ていない/我家还未开通大容量的线路｣
⑩感情・感覚などの作用が生じる。/产生感情或感觉的作用。
｢痛みが去ると空腹感が来た/疼痛感一去立刻有一种饥饿感｣
｢喜びの後に悲しみが~/喜悦之后悲伤而生｣
｢『〔肩をもんだときの痛みが〕来ますか？』『結構来ますねえ』/"（揉肩时的痛感）疼吗？”“相当疼。”｣
⑪《「…から~」の形で》/（以“…から~”的形式）
㋐言語や文化が…に由来する。…から入ってくる。/从……传来的。语言及文化由……而来。｢『クーデター』という語は仏語から来た/“クーデター”这个词是由法语来的｣｢儒教思想は中国から来た/儒教思想是由中国传来的｣
㋑あることが原因・契機となって、そのことが起こる。起因する。/由于，起因于……。某件事情作为起因，契机而发生另一件事。｢疲労から~病気/由于疲劳得的病｣語法（イ）は連体形「来る」、または「来ている」の形で使う。
⑫《「…に~」「…まで~」などの形で》事態がある局面（特に、最終的な段階）に至る意を表す。/（以“…に~”“…まで~”等形式）表示事态发展到某种局面（特别是最终阶段）的意思。
｢あと五分というところへ来て邪魔が入った/到了还剩五分钟的时候，出现了麻烦｣
⑬《「がたが~」の形で》〔俗〕使いすぎたり古くなったりして快適な働きがにぶる。ほころびる。がたが行く。/（以“がたが~”的形式）不灵了。使用过度，变旧以后，原先顺畅的功能减弱了。迟钝。衰弱。
｢体にガタが~/身体变得不好使了｣
⑭《擬態語＋「と~」の形で》/（以拟态词“と~”的形式）
㋐動作・作用の及ぼす影響がじかにこちらに及ぶ。/动作、作用直接波及，产生影响。动作、作用所波及的影响直接到达这里。｢わさびが鼻につんと~/山斎菜的气味刺鼻｣｢触ると静電気がびりっと~/一触摸，静电麻酥酥地传过来｣｢雨がほおにぽつりと来た/雨滴滴答答地落在脸颊上｣
㋑感情・感覚などの反応が起こる。/引起感情、感觉等反应。｢第六感にぴんと~/一下子触发了我的第六感｣｢心にぐっと~（＝物事に深く感動する）/心被打动（＝深受感动）｣｢がっくりと~/突然无力；颓丧｣｢頭にかちんと~（＝怒りの気持ちが起こる）/勃然大怒（＝生气）｣
⑮《「しっくり~」「ぴったり~」などの形で》物事がこちらの気持ちにうまく適合する。/（以“しっくり~”“ぴったり~”的形式）事情与自己的心情完全适合。吻合。融洽。
｢その意見は僕にはしっくりこないなあ/那个意见与我的不吻合｣
｢今の気分にこんなにぴったり~音楽はない/没有如此适合现在心情的音乐了｣
⑯《上に「こう・そう」「…で」「…と」などの副詞句を伴って》相手がある態勢をとってこちらに対処する意を表す。/（前面与“こう・そう”“…で”“…と”等副词句相伴）表示对方采取某种态势应对自己之意。
｢そう来なくちゃ面白くない/如果不那么做的话，就没有意思了｣
｢奴さん、またしても『お願いします』と／で 来たな/那家伙又来央求我说“求您了”｣
⑰《「…と来たもんだ」の形で》〔俗〕その事態を満足すべきことや当たり前のこととして受け入れる意を表す。/（以“…と来たもんだ”的形式）作为令人满足的事情或理所当然的事情等欣然接受该情况。
｢うれしいね、旅は道連れ酒は吟醸と来たもんだ/好开心啊！旅行要有伴，喝酒喝“吟釀”……｣
⑱《「…と~と」「…ときては」「…ときたら」「…ときた日にゃ」などの形で》相手の話題を見計らってこちらに引き取るといった気持ちで、物事を題目としてとりたてる。/（以“…と~と”“…ときては”“…ときたら”“…ときた日にゃ”等形式）以斟酌对方的话题并把话题引向自己的心情，来谈论成为题目的事物。说起……。提起……。
｢音楽と~とやはりモーツァルトだね/说起音乐，还属莫扎特啊｣
｢今時の大人ときたら全くしょうがないなあ/一提到现在的成年人，真是没有办法｣
表現「…ときたら」「…ときた日にゃ」には、多くあきれる気持ちなどがこもる。また、後者は俗語的な言い方。
①《実質的意味を半ばとどめた用法》/（实际的意思限于一半的用法）
㋐…した後で、（また）そこに来る意を表す。/表示在…之后又来，做完后再来之意。｢文句を言って~/发起牢骚来｣｢顔を洗って出直して来い/去清醒一下脑子再来｣
㋑そのようなしかたで来る意を表す。/以那种方式来。｢歩いて~/走着来｣｢終点まで立って来た/一直站到终点｣
㋒ある動作が、近づいてくる動作と並行して行われる意を表す。~しながら来る。/和某一个动作同时发生。某动作和往这方推近的动作同时发生。一边……一边来。｢土産を持って~/带来土特产｣｢ベビーカーを押して~/推着婴儿车来｣
㋓話し手に近づく動作である意を表す。/表示和说话人相近的动作（去做某事或动作后回来）。｢帰って~/回来｣｢波が寄せて~/波浪涌过来｣｢向こうからやって~/从对面走过来｣表現複合化の度合いが強く、文語的な表現では「て」が現れず、「寄せ来る」「迫り来る」などとなることが多い。
②《形式化した用法》時間的・心理的に近づく気持ちを伴いながら、過去（または、基準となる時点）から現在までの事態の展開を表す。/（形式化的用法）表示伴随着与时间、心理接近的心情，从过去（或某一个基准的时间）到现在的事态的发展。……起来。
｢少しずつ賛同者が増えて~/赞同者逐渐增多｣
｢だんだんと事情がはっきりして~/事态逐渐变得明晰起来｣
｢日に増して元気が出て~/一天天变得精神起来｣
◈表記実質的意味が薄まった[1](11)以降はかな書きも多い。[2]はかな書きが多い。特に、[2](2)は積極的にかなで書かれる。文く（カ変）
```

### `一人天下`

Unusual explicit heading with segmentation, annotated brackets, and alternate orthography.

```text
ひとり‐てんか［⟪一人⟫天下・独り天下］
【名】
◯だれも抑える人がなくて、自分ひとりが思うままに振る舞うこと。ひとりでんか。/天下第一，独断专行。没有他人控制，自己可以为所欲为。一个人的天下。
```

### `ace`

Malformed/mixed quote conversion in Chinese prose; preserve raw punctuation.

```text
【名】
①トランプの、1。記号A/A牌。扑克牌中的“1”。符号为A。
｢スペードの~/黑桃A｣
②スポーツで、チームの第一人者。特に、野球の主戦投手。/主力。（棒球）主力投球手。体育运动中，球队的绝对主力。特指棒球的主力投球手。
③組織の第一人者。/头头，老板。组织中的第一人。
｢販売部の~/销售部的头头｣
④「サービスエース」の略。/"サービスエース”的略语。
```

### One of the longest entries

`謂ウ` is 16,527 UTF-8 bytes. It exercises many numbered blocks, examples, notes, and subdivisions. The raw record follows in full:

```text
【他五】
①口を動かして（また、字に書いて）思っていることなどをことばで表す。/说，讲述。开口把正在思考的事情等用语言表达出来（或者写成文字）。
｢『あ、雨』と~・って走り出す/“啊，下雨了”，说完后就跑了起来｣
｢意見［お礼・寝言］を~/说意见［感谢的话・梦话］｣
｢電話するように~・っておきます/告诉（他）打电话｣
｢体が~ことを聞かない（＝体が思うように動かない）/身体不听话（＝身体不听使唤）｣
｢~に及ばない（＝当然すぎて言う必要がない。いうまでもない）/自不待言（＝理所当然，没有说的必要，不必说）｣
｢~・わずと知れた（＝分かりきった）ことだ/不言自明（＝洞悉）的事情｣
｢~・わぬが花（＝口に出して言わないほうがかえって趣があったり差し障りがなかったりする）/沉默是金（＝不说出口反而更有含义或不造成隔阂）｣
｢~だけ野暮（＝誰でも知っていることをことさら口にするのはばかげている）/说那种话不知趣（＝谁都已经知道了的事情再特意说出口就显得太傻气了）｣
｢よく~よ（＝よくもぬけぬけと言ったものだの意で、厚かましい発言などを非難していうことば）/大言不惭（＝表示厚颜无耻地说出来的意思，是对厚脸皮发言的谴责）｣
｢~は易く行うは難し（＝実行の難しいことをいう）/说起来容易做起来难（＝指实行是很困难的）｣
｢彼のことを悪く［ぼろくそに］~/ⓚ说他的坏话［把他说得一钱不值］｣
表現⑴「言う」は発話行為の全般にわたって広く使い、「話す」は主にまとまった内容をことばにする意で限定的に使う。「今日は！」「よろしくお伝え下さい」などは、「言う」だが「話す」ではない。その点では「しゃべる」「語る」「述べる」も「話す」と同様。⑵「言う」の尊敬語には「おっしゃる・仰せられる」が、謙譲語には「申す・申し上げる」のほか「言上する・上奏する・啓上する」などがある。
②ある語をあるしかたで発音する。その語形でとなえる。/说成，称作。用某种方法来说出某个词汇的发音，用特定语形发音。
｢『ペダル』と~・わずに『ペタル』と~/不说成“ペダル”，而说是成“ペタル”｣
③物事などをことばで（また、あることばを別のことばで）表現する。/称呼，称为。用词汇（或把某个词汇用别的词汇）表达事物。
｢これを奇跡と~・わずして何と~・おう/不把这个叫做奇迹那把什么叫为奇迹呢｣
｢彼をこそ天才と~べきだ/只有他这样的人才称为天才｣
｢~・い得て妙（＝絶妙の表現をほめていう）/可以称之为绝妙之言（＝褒奖精彩绝妙的表现说的话）｣
④記号（特に、ことば）がある内容を表す。指す。示す。/表示，指示。表示有符号的（尤其指语言）内容。
｢この論説は人類が危機に陥っていることを~・っている/这个论断表明人类陷入了危机之中｣
｢案内図の~とおりに進む/按照向导图指示前进｣
⑤《「と~」「と~・われる」の形で、終止形で言い切る文を受けて》多くの人がそう述べ、そう認めていることを表す。…ということが言われる。…ということだ。…とのことだ。/（用“と~”“と~・われる”的形式，承接以终止形断句的句子）据说，听说。表示很多的人这样说，这样认为的意思。
｢台風は明日にも上陸すると~/据说台风明天会登陆｣
｢二〇世紀は一般に科学の時代だと~・われる/20世纪一般被称作是科学的时代｣
⑥《補助的に》/（补助）
㋐《「と~」の形で》下の語で上の語の内容を説明するのに使う。/（用“と~”的形式）用后文来说明前文的句子时使用。｢これが会社と~組織の在り方だ/这是公司这种组织的存在方式｣｢出席できないと~理由を説明する/说明不能出席的理由｣語法列挙・例示する気持ちを添えていうときは「…と~・った」とも。｢文学とか芸術とかと~・ったものには興味がない/ⓚ对文学艺术之类的东西不感兴趣｣
㋑《「と~」の形で、上に数量を表す語を伴って》上の語の表す数量を特別のものとみなして、下の語でその内容を説明するのに使う。/（用“と~”的形式，上接表示数量的单词）把上文表示的数量看做是特别的事物并在下文中对此内容进行说明时使用。｢一〇億円と~金が浪費された/10亿日元的金额被浪费掉了｣｢一〇人と~わずかな参加者しかなかった/仅仅只有10人参加了｣
㋒《「Aと~A」の形で》それに属するものはすべての意を表す。また、強調を表す。/（用“Aと~A”的形式）表示属于那个范围内的所有东西或表示强调。｢窓と~窓は閉ざされている/所有的窗户都关着｣｢条件と~条件は洗い出した/所有的条件都搞清楚了｣｢今度と~今度は我慢がならない/这次是再也不能忍受了｣
㋓《「Aと~・いBと~・い」の形で》複数の事柄を例示してとりたてる。AもBも。AだってBだって。/（用“Aと~・いBと~・い”的形式）来列举复数的事项。A、B都是。A也是B也是。｢手と~・い足と~・い傷だらけだ/手上和腿上净是伤｣｢知性と~・い感性と~・い申し分ない/不论是在理性上还是感性上都没有可以挑剔的地方｣表現AB以外にも例示できるといった含みを伴い、より明示的に「…Cと~・いDと~・い…」と続けることもある。また、否定表現「Aと~・わずBと~・わず…」は、ABは言わずもがなの気持ちで、意味を強める。区別なしに全部。｢顔と~・わず手と~・わず虫に刺された/ⓚ脸和手都被虫子叮了｣
㋔《「こう」「そう」「ああ」＋「~」「~・った」の形で》それと類似または近似するという気持ちを添えながら、物事や事柄を例示する。この［その・あの］ような~。こんな［そんな・あんな］~。/（以“こう”“そう”“ああ”＋“~”“~・た”的形式）通过表达与某物类似或者近似，来列举事物及事项。｢こう~場合はこうするといい/在这样的场合，这样做比较好｣｢ああ~・ったことがときどき起こる/那种事情经常会发生｣
㋕《「どう」＋「~」「~・った」の形で》物事や事柄を定かではないものとして示す。どのような~。どんな~。/（用“どう”十“~”“~・った”的形式）表示事物和事情不确定，什么样的，怎么样的。｢彼がどう~人かは知らない/并不知道他是怎么样的人｣｢二人の間にはどう~・ったことがあったのだろうか/那两个人之间到底发生了什么｣
㋖《「これ」＋「と~」「と~・った」「と~・って」の形で、下に否定の語を伴って》特にとりたてていうべきことがない意を表す。/（用“これ”十“と~”“と~・った”“と~・って”的形式，后接否定形）表示没有什么需要特别提出的事情。｢これと~問題点も見当たらない/没发现什么问题｣｢別にこれと~・って意見はありません/没什么特别的意见｣
㋗《「どれ」「なに」「どこ」「だれ」「なぜ」「いつ」＋「と~・って」の形で、下に否定の語を伴って》特にとりたてていうべき物事・場所・人・理由が見当たらない意を表す。/（用“どれ”“なに”“どこ”“だれ”“なぜ”“いつ”＋“と~・つて”的形式，后接否定形）表示没有找到需要特别提出的事物、场所、人或理由。｢なにと~・って欲しい物はない/没什么特别想要的东西｣｢どこと~・って体に悪い所はない/身上哪儿都很好｣｢なぜと~・って特別の理由はない/没什么特别的理由｣表現問いに答える形で、要件を総当たりする気分を伴う。
㋘《「何」「どう」＋「と~ことはない」の形で》特にとりたてて問題にすべき点がない意を表す。どうこういうことはない。なんてことはない。/（用“何”“どう”十“と~ことはない”形式）表示没有特别值得一提的问题，没什么值得一说，没什么大不了。｢総会はなんと~こともなく終わった/总会很平安地结束了｣｢あんなやつなど、どうと~ことはない/那种人啊，没什么大不了的｣
㋙《「と~のは」の形で》名辞の定義を表すのに使う。また、名辞の指す物事を主題として取り上げるのに使う。/（用“と~のは”的形式）用于表示名词的定义或用于提取名词所指事物为主题。｢『人』と~のは言葉を使う動物の意だ/所谓“人”就是能说话的动物的意思｣｢世間と~のは厄介なものだ/所谓人世就是令人烦扰啊｣｢ある人と~のは誰のことだ/所谓的某人到底是谁啊｣
㋚《「と~と」「と~・えば」「と~・ったら」の形で》題目を提示するのに使う。…（ということ）について言えば。…を話題にすれば。…に言及すれば。/（用“と~と”“と~・えば”“と~・ったら”的形式）用于提示题目，就……而言。要是说……，提及……。｢相談と~と例の件ですか/你说的商量是不是指的那件事｣｢優勝と~・えば今日は千秋楽だ/说到争夺冠军，那今天可是最后的比赛啊｣｢最も混雑する時間帯と~・ったら朝の七時台だ/要说道路最堵的时间，那就是早上七点左右了｣
㋛《「かと~と」「かと~・えば」「かと~・ったら」の形で》提示された疑問に対する答えを述べるときの前置きに使う。/（用“かと~と”“かと~・えば”“かと~・ったら”的形式）叙述被提及问题的答案时用的开场白。｢犯人は誰かと~と、お前だ/犯人是谁呢，就是你｣｢なぜ休んだかと~と、頭痛がひどかったからです/为什么歇了呢，是因为头疼得非常厉害｣
㋜《「Aと~・えばA」の形で》…と言えないこともない意を表す。/（用“Aと~・えばA”的形式）表示也不是不能说……。｢寒いと~・えば寒い/要说冷还真冷｣｢優勝に貢献したと~・えば貢献した/要说对取得胜利做出了贡献，的确做了贡献｣表現判断・評価に迷う気持ちを暗示し、下に同趣の否定・反意表現を伴うことも多い。…とも言えるし…でないとも言える。｢授業は面白いと~・えば面白い、少々退屈だと~・えば退屈だ/ⓚ上课说有趣也有趣，说有点无聊也有点无聊｣
㋝《「から~と」「から~・えば」「から~・って」の形で》話し手の基準となる視点を表す。…からする［見る］と。/（用“から~と”“から~・えば”“から~・って”的形式）表示作为说话人标准的视点，从……而言。｢消費者の立場から~と値下げ競争は好ましいということになる/从消费者的立场而言，价格战是件好事｣｢値段から~・ってこちらがお得です/就价格而言我方是合算的｣
㋞《状態を表す語＋「と~・ったらない」の形で》言いようがないほど…だの意で、程度を強調する。これ以上に…なことはない。…ったらない。/（用表示状态的单词＋“と~・ったらない”的形式）以无法言说的意思表示程度的强调。再没有更。｢すばらしいと~・ったらない/再没有更精彩的了｣｢褒められたときのうれしさと~・ったらない/再没有比被表扬的时候更高兴的了｣
㋟《「と~ことだ」の形で》伝聞を表す。…とのことだ。…だそうだ。/（用“と~ことだ”的形式）表示传闻，据传……，据说。｢今年は一〇年ぶりの猛暑だと~ことだ/据说今年是近十年来的酷热年｣
㋠《「と~ものだ」の形で》話し手の判断を断定・強調する。/（用“と~ものだ”的形式）断定、强调说话人的判断。｢成功したのだから苦労のしがいもあったと~ものだ/取得了成功，所以付出的辛苦也值得｣｢それはあんまりと~ものだ/那也太过分了｣
㋡《「とは~・え」「と~・って」「と（は）~・っても」「とは~ものの」「とは~・いながら」などの形で》前提を認めたうえで、それに反することが成り立つ意を表す。…だけれども、しかし。…だとしても。…といえども。/（用“とは~・え”“と~・って”“と（は）~・っても”“とは~ものの”“とは~・いながら”等形式）表示在承认前提的基础上，与其相反的事项也成立，即使…，就算。｢いやになったからと~・って辞めるわけにもいかない/不能因为你不喜欢就不干了｣｢読んだとは~ものの精読してはいない/读是读过但没有细读｣語法接続詞的にも使う。「休みたい。とは~・え、休むわけにはいかない」
㋢《「（そう）かと~・って」の形で、下に否定的な表現を伴って》前提から予想されることが、現実には成り立たない意を表す。しかし、そうはいうものの。さりとて。/（用“（そう）かと~・って”的形式，后接否定性的表达形式）表示前提中所预想的事情在实际上并不能实现。｢害にはならないが、かと~・って役に立つわけでもない/虽然不会造成危害，但也并非有什么作用｣
㋣《「それと~のも」の形で、多く下に「…から（なの）だ」など理由を表す表現を伴って》前文が成り立つ理由を補足的に説明するのに使う。なぜそうかと言うと。/（用“それと~のも”的形式，常后接“…から（なの）だ”等表示理由的内容）用于补充说明前文成立的理由。｢料理の腕前は玄人はだしだが、それと~のも食い道楽だからだ/我的烹饪技术赛过行家那也是因为我非常讲究吃｣
㋤《「からと~・って」の形で、下に否定的な表現を伴って》理由となるべき根拠が一般に認められるとしても、必ずしも正当な理由とはならない意を表す。…からって。/（用“からと~・て”的形式，后接否定性的表达形式）表示能成为理由的根据虽被认同，但也未必是正当理由。｢入選したからと~・ってそんなに自慢するものではない/就是入选了也不该那么洋洋得意｣｢社長だからと~・ってごり押しは困る/虽然是总经理但蛮干也是行不通的｣
◯《擬音語＋「（と）~」の形で》人以外の動物が声を出す。鳴く。また、物が音を立てる。鳴る。/（用拟声词＋“（と）~”的形式）人以外的动物发出声音、鸣叫，或物体发出声音、鸣动。
｢犬がワンワン~・って餌を求める/狗汪汪地叫着要食物｣
｢雨戸ががたがた~/木套窗嘎吱嘎吱地响着｣
｢腹がグーグー~/肚子饿得咕咕叫｣
◈表記⑴「言う」の発音は「ユー」であるが、「言います」などでは「イー」となる。現代仮名遣いでは、語幹を「い」にそろえて「いう」と書くことになっている。「ソーユー」「ユワユル」なども正式の仮名遣いとしては「い」（そういう・いわゆる）。⑵[1](1)~(4)は「言」、[1](5)(6)と[2]はかな書きが一般的。「謂」は主に「謂わゆる」「…の謂」「謂わば」などと、「云」は「田中と云う人」「『真実』と云う語」などと使うが、今はかな書きが一般的。可能言える
```

## 15. Proposed Meikyo Parser Specification v1

```text
SOURCE STRUCTURE
  StarDict index key + UTF-8 payload
  headings / labels / marker-prefixed blocks / examples / notes / links
        ↓ lossless parse with validation and raw fallbacks
PARSER AST
  SourceEntry { indexKey, payloadRaw, nodes[], diagnostics[] }
  Heading | Label | DefinitionBlock | Example | Note | Expression |
  Derivative | Redirect | LinkRecord | RawLine
        ↓ separate, policy-driven canonical mapping
CANONICAL DICTIONARY MODEL
  forms/readings/tags/entry definitions/senses/definitions
  only where the AST evidence satisfies mapping invariants
```

Normative v1 rules:

1. Parse StarDict offsets as declared (default 32-bit); reject any out-of-range extent or invalid UTF-8 before entry parsing. Preserve `indexKey`, exact `payloadRaw`, byte offset, size, and ordinal.
2. Recognize the custom `@@@LINK=░display░【source】🗏page№id[warning]` wrapper and plain `→ target` records before lexical parsing. Store every component and raw text. Do not resolve or canonicalize a link unless its target exists and a documented relationship check passes.
3. Treat a first complete `【...】` line as a label and use the index key as the implicit heading. Otherwise attempt the explicit `reading［orthography］` grammar. Strip source segmentation only into a derived normalized reading; preserve all bracket and spelling text. If validation fails, emit `Heading(raw=...)` or `RawLine`, never a guessed reading.
4. Tokenize physical lines in order. Leading `◯` or `①`–`⑳` creates `DefinitionBlock(marker, rawBody)`. Preserve marker sequences exactly, including repeats, skips, restarts, and mixing. Subordinate marker systems become child tokens only when balanced and positionally valid.
5. Within a recognized definition block, attempt one Japanese/Chinese split. Do not split if empty/multiple slashes or lexical slash notation makes the boundary ambiguous; retain `rawBody` and add a diagnostic. A successful split still retains raw.
6. A line beginning `｢` becomes `Example(raw, japanese?, chinese?, diagnostics)`. Require a closing delimiter and exactly one validated alignment slash for structured bilingual fields. Attach by source order to the active definition block; retain entry-level position if no active block exists.
7. Preserve standalone `【...】` as `Label(raw)`. Do not normalize its semantics in parser v1. A later mapping table may interpret known composites.
8. Preserve `▶` as `Note(kind=unknown, raw)`. Preserve `◈` with optional controlled prefix `{表記,語法,表現,注意,語源}`. Preserve standalone `表現` and `派生`; derivative splitting is optional and validation-gated. Unknown lines always become `RawLine`.
9. Emit diagnostics for missing link targets, unexplained link relationships, unbalanced punctuation, malformed examples, numbering skips/restarts, and unknown structures. Diagnostics never mutate source text.
10. Canonical mapping is a separate pass. It may map validated headings/forms/readings and definition blocks, but must not overload canonical definitions with examples, usage notes, etymology, derivatives, or source link metadata. If the current schema cannot represent a concept, retain it in AST/raw audit output and defer import of that concept.

The AST should minimally carry source spans or line ordinals so later mapping can preserve ownership. `EntryNote`, `BlockNote`, `Example`, `Etymology`, `Usage`, `Expression`, and `Derivative` are source concepts that the current canonical model may not represent cleanly; they must not be stuffed into definition strings or tags merely to avoid extending a future model.

## 16. Unresolved questions

- What conversion process produced the 31,467 unexplained custom-link mappings, and is the index key, encoded target, page/id, or an external source table authoritative?
- What do `🌸`, `🍀`, `ⓚ`, `▾`, `▿`, and `🡺` mean in the conversion vocabulary?
- Are numbering restarts intended as homographs, grammatical blocks, or editorial groups in every context?
- Which one-slash Japanese/Chinese pairs that lack kana can be validated linguistically without over-classifying Chinese-only/Japanese-only text?
- Should explicit alternative spellings inside annotated brackets become independent canonical forms, and how should their reading restrictions be represented?
- Does a future schema need first-class examples, block-scoped notes, usage, etymology, expression notes, and derivatives before importing those concepts?
- How should four plain redirects and 240 custom links with missing targets behave?
- Which punctuation imbalances are faithful source typography versus recoverable conversion errors?

## 17. Safety recommendation

A deterministic **lossless source parser** is safe: 100% of records decode, 97.850% of non-link entries are fully tokenizable by the small line grammar, and every unknown can fall back to a raw node. A deterministic importer that directly forces every record into canonical senses is not yet safe. The link mismatch population, marker restarts/skips, fragment entries, slash exceptions, and currently unrepresentable examples/notes/derivatives require validation gates and raw preservation. Implement the v1 AST first, measure its diagnostics against this audit, then define a narrower canonical mapping contract. Quarantine or preserve custom link records until their conversion provenance is explained.

## Reproduction

Files created by this investigation:

- `analysis/meikyo_corpus_audit.py` — read-only full-corpus scanner; JSON output was written to `/tmp`.
- `analysis/render_meikyo_audit.py` — deterministic Markdown renderer.
- `MEIKYO_PARSER_AUDIT.md` — this report.

Commands used:

```bash
/usr/bin/time -v python3 analysis/meikyo_corpus_audit.py '/mnt/c/Users/Administrator/Downloads/sdcv_dictionaries-main/sdcv_dictionaries-main/stardict_明镜日汉双解辞典' --output /tmp/meikyo_audit.json
python3 analysis/render_meikyo_audit.py /tmp/meikyo_audit.json MEIKYO_PARSER_AUDIT.md
python3 -m py_compile analysis/meikyo_corpus_audit.py analysis/render_meikyo_audit.py
git diff --check
```

Final scan runtime: 18.011 seconds inside the script, 18.40 seconds wall clock under `/usr/bin/time`; peak resident memory 258,864 KiB. Corpus coverage: 209,052/209,052 records (100%). Entries that could not decode: 0. Entries with at least one unclassified physical line: 3,568; these are retained as raw nodes rather than discarded.

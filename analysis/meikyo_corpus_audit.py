#!/usr/bin/env python3
"""Full-corpus, read-only structural audit for the Meikyo StarDict source."""

from __future__ import annotations

import argparse
import collections
import gzip
import hashlib
import json
import re
import statistics
import struct
import time
import unicodedata
from pathlib import Path

PRIMARY_MARKERS = "◯①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
NUMBERED_MARKERS = PRIMARY_MARKERS[1:]
SUBSENSE_MARKERS = "㋐㋑㋒㋓㋔㋕㋖㋗㋘㋙㋚㋛㋜㋝㋞㋟㋠㋡㋢㋣㋤㋥㋦㋧㋨㋩㋪㋫㋬㋭㋮㋯㋰㋱㋲㋳㋴㋵㋶㋷㋸㋹㋺㋻㋼㋽㋾"
KNOWN_DIAMOND_LABELS = ("表記", "語法", "表現", "注意", "語源")
KNOWN_LINE_SECTIONS = ("表現", "派生", "語源", "類語", "対義語", "参考", "注意", "表記", "用法", "語法")
QUOTE_PAIRS = {"｢": "｣", "「": "」", "『": "』", "“": "”", "‘": "’", "《": "》", "〈": "〉"}
BRACKET_PAIRS = {"［": "］", "【": "】", "（": "）", "〔": "〕", "⟪": "⟫", "⟨": "⟩"}
ARTIFACT_TOKENS = ("@@@LINK=", "░", "🗏", "⚠️", "🌸", "🍀", "▾", "▿", "ⓚ", "🡺")
KANA_RE = re.compile(r"[\u3040-\u30ffー]", re.UNICODE)
HAN_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]", re.UNICODE)
ASCII_NUMBER_RE = re.compile(r"(?<![\w])\((\d{1,2})\)")
SQUARE_NUMBER_RE = re.compile(r"\[(\d{1,2})\]")
PAREN_NUMBER_CHARS = "⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⑾⑿⒀⒁⒂⒃⒄⒅⒆⒇"
LINK_RE = re.compile(r"^(.*?) @@@LINK=░(.*?)░【(.*?)】🗏(\d+)№(\d+)(⚠️.*)?$")
PLAIN_REDIRECT_RE = re.compile(r"^→\s*(.+)$")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def examples(counter: collections.Counter, sample_map: dict, limit: int = 5) -> list[dict]:
    return [{"value": key, "count": count, "examples": sample_map.get(key, [])}
            for key, count in counter.most_common(limit)]


def add_sample(mapping: dict, key, value, limit: int = 3) -> None:
    values = mapping.setdefault(key, [])
    if value not in values and len(values) < limit:
        values.append(value)


def parse_index(index_bytes: bytes, offset_bits: int) -> tuple[list[tuple[str, int, int]], dict]:
    records: list[tuple[str, int, int]] = []
    failures = []
    cursor = 0
    width = 8 if offset_bits == 64 else 4
    while cursor < len(index_bytes):
        terminator = index_bytes.find(b"\0", cursor)
        if terminator < 0 or terminator + 1 + width + 4 > len(index_bytes):
            failures.append({"cursor": cursor, "reason": "truncated index record"})
            break
        raw_word = index_bytes[cursor:terminator]
        try:
            word = raw_word.decode("utf-8")
        except UnicodeDecodeError as error:
            failures.append({"cursor": cursor, "reason": f"headword UTF-8: {error}"})
            word = raw_word.decode("utf-8", errors="replace")
        cursor = terminator + 1
        if width == 8:
            offset = struct.unpack(">Q", index_bytes[cursor:cursor + 8])[0]
        else:
            offset = struct.unpack(">I", index_bytes[cursor:cursor + 4])[0]
        cursor += width
        size = struct.unpack(">I", index_bytes[cursor:cursor + 4])[0]
        cursor += 4
        records.append((word, offset, size))
    return records, {"failures": failures, "consumed_bytes": cursor}


def slash_shape(line: str, marker_length: int = 0) -> str:
    content = line[marker_length:]
    count = content.count("/")
    if count == 0:
        return "none"
    if count > 1:
        return "multiple"
    left, right = content.split("/", 1)
    if not left:
        return "right-only"
    if not right:
        return "left-only"
    left_kana = bool(KANA_RE.search(left))
    right_kana = bool(KANA_RE.search(right))
    if left_kana and not right_kana and bool(HAN_RE.search(right)):
        return "obvious-ja-zh"
    return "one-ambiguous"


def compact_sequence(values: list[str]) -> str:
    result = []
    for value in values:
        if result and result[-1].split("×", 1)[0] == value:
            base, _, count = result[-1].partition("×")
            result[-1] = f"{base}×{int(count or '1') + 1}"
        else:
            result.append(value)
    return " ".join(result) or "EMPTY"


def line_kind(line: str, index: int, has_initial_pos: bool) -> str:
    if "@@@LINK=" in line:
        return "L"
    if PLAIN_REDIRECT_RE.fullmatch(line):
        return "R"
    if index == 0 and not has_initial_pos:
        return "H"
    if re.fullmatch(r"【[^】]*】", line):
        return "P"
    if line and line[0] == "◯":
        return "D◯"
    if line and line[0] in NUMBERED_MARKERS:
        return "D#"
    if line.startswith("｢"):
        return "E"
    if line.startswith("▶"):
        return "▶"
    if line.startswith("◈"):
        label = next((x for x in KNOWN_DIAMOND_LABELS if line[1:].startswith(x)), None)
        return f"◈{label or 'raw'}"
    section = next((x for x in KNOWN_LINE_SECTIONS if line.startswith(x)), None)
    if section:
        return section
    return "RAW"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dictionary_dir", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    started = time.perf_counter()
    directory = args.dictionary_dir
    stem = directory / "明镜日汉双解辞典"
    paths = {suffix: Path(f"{stem}{suffix}") for suffix in (".ifo", ".idx", ".idx.oft", ".dict.dz")}

    metadata = {}
    for line in paths[".ifo"].read_text(encoding="utf-8-sig").splitlines()[1:]:
        if "=" in line:
            key, value = line.split("=", 1)
            metadata[key] = value
    offset_bits = int(metadata.get("idxoffsetbits", "32"))
    index_bytes = paths[".idx"].read_bytes()
    records, index_result = parse_index(index_bytes, offset_bits)
    record_starts = []
    cursor = 0
    width = 8 if offset_bits == 64 else 4
    while cursor < len(index_bytes):
        record_starts.append(cursor)
        cursor = index_bytes.index(b"\0", cursor) + 1 + width + 4
    oft_bytes = paths[".idx.oft"].read_bytes()
    oft_header = b"StarDict's Cache, Version: 0.2"
    oft_values = []
    oft_error = None
    if not oft_bytes.startswith(oft_header) or len(oft_bytes) < len(oft_header) + 4:
        oft_error = "unexpected header or truncated cache"
    else:
        values_raw = oft_bytes[len(oft_header) + 4:]
        if len(values_raw) % 4:
            oft_error = "offset table length is not divisible by four"
        else:
            oft_values = list(struct.unpack(f"<{len(values_raw) // 4}I", values_raw))
    expected_oft = record_starts[::32] + [len(index_bytes)]
    with gzip.open(paths[".dict.dz"], "rb") as stream:
        payload = stream.read()

    headword_counts = collections.Counter(word for word, _, _ in records)
    sizes = [size for _, _, size in records]
    invalid_offsets = []
    invalid_sizes = []
    zero_lengths = []
    decode_failures = []
    decoded: list[tuple[str, str, int, int]] = []
    for ordinal, (word, offset, size) in enumerate(records):
        if offset > len(payload):
            invalid_offsets.append({"ordinal": ordinal, "headword": word, "offset": offset})
            continue
        if offset + size > len(payload):
            invalid_sizes.append({"ordinal": ordinal, "headword": word, "offset": offset, "size": size})
            continue
        if size == 0:
            zero_lengths.append({"ordinal": ordinal, "headword": word})
        raw = payload[offset:offset + size]
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as error:
            decode_failures.append({"ordinal": ordinal, "headword": word, "error": str(error)})
            text = raw.decode("utf-8", errors="replace")
        decoded.append((word, text, offset, size))

    marker_occurrences = collections.Counter()
    marker_anywhere = collections.Counter()
    marker_entries = collections.Counter()
    marker_sequences = collections.Counter()
    marker_sequence_samples = {}
    marker_mixed = marker_repeated = marker_skip = marker_restart = 0
    marker_nested = collections.Counter()
    marker_nested_entries = collections.Counter()
    marker_nested_samples = {}
    pos_counts = collections.Counter()
    pos_samples = {}
    diamond_labels = collections.Counter()
    diamond_label_entries = collections.Counter()
    diamond_samples = {}
    section_counts = collections.Counter()
    section_entries = collections.Counter()
    section_positions = collections.Counter()
    section_samples = {}
    arrow_payload_prefix = collections.Counter()
    arrow_samples = {}
    derivative_shapes = collections.Counter()
    derivative_samples = {}
    slash_counts = {"definition": collections.Counter(), "example": collections.Counter(), "other": collections.Counter()}
    slash_entries = {kind: collections.Counter() for kind in slash_counts}
    slash_samples = {kind: {} for kind in slash_counts}
    example_delimiters = collections.Counter()
    quote_counts = collections.Counter()
    quote_entry_imbalances = collections.Counter()
    quote_imbalance_samples = {}
    bracket_counts = collections.Counter()
    bracket_entry_imbalances = collections.Counter()
    bracket_imbalance_samples = {}
    artifact_counts = collections.Counter()
    artifact_entries = collections.Counter()
    artifact_samples = {}
    example_counts = collections.Counter()
    examples_before_note = examples_after_note = 0
    heading_patterns = collections.Counter()
    heading_samples = {}
    heading_relation = collections.Counter()
    heading_relation_samples = {}
    shape_counts = collections.Counter()
    shape_samples = {}
    unclassified_line_count = 0
    entries_with_unclassified = 0
    anomaly_counts = collections.Counter()
    anomaly_samples = {}
    codepoint_counts = collections.Counter()
    longest_entries = []
    selected = collections.defaultdict(list)
    link_counts = collections.Counter()
    link_samples = {}
    redirect_counts = collections.Counter()
    redirect_samples = {}
    headword_set = set(headword_counts)

    for word, text, offset, size in decoded:
        lines = text.splitlines()
        nonempty = [line for line in lines if line]
        longest_entries.append((size, word, text))
        if word in {"一生懸命", "食べる", "曖昧", "せっかく", "覚える", "おぼえる",
                    "a cappella", "clear", "あがる", "あつい", "くる", "一人天下", "ace", "謂ウ"}:
            selected[word].append(text)

        link_match = LINK_RE.fullmatch(text)
        redirect_match = PLAIN_REDIRECT_RE.fullmatch(text)
        if "@@@LINK=" in text:
            link_counts["records"] += 1
            if not link_match:
                link_counts["malformed"] += 1
                add_sample(link_samples, "malformed", {"headword": word, "payload": text})
            else:
                target, display, source, page, source_id, warning = link_match.groups()
                link_counts["parsed"] += 1
                if target in headword_set:
                    link_counts["target-in-index"] += 1
                else:
                    link_counts["target-missing"] += 1
                    add_sample(link_samples, "target-missing", {"headword": word, "target": target, "payload": text})
                if word == target:
                    relation = "headword=target"
                elif word == display:
                    relation = "headword=display"
                elif word.casefold() == target.casefold():
                    relation = "casefold-target"
                elif word in source:
                    relation = "headword-in-source-orthography"
                else:
                    relation = "unexplained-mismatch"
                link_counts[relation] += 1
                add_sample(link_samples, relation, {"headword": word, "target": target, "display": display, "source": source})
                if warning:
                    link_counts["warning-marker"] += 1
        if redirect_match:
            redirect_counts["records"] += 1
            raw_target = redirect_match.group(1)
            target = raw_target.split(" 【", 1)[0].strip()
            if target in headword_set:
                redirect_counts["target-in-index"] += 1
            else:
                redirect_counts["target-missing"] += 1
                add_sample(redirect_samples, "target-missing", {"headword": word, "target": target, "payload": text})
            add_sample(redirect_samples, "records", {"headword": word, "target": target, "payload": text})

        primary_sequence = [line[0] for line in nonempty if line[0] in PRIMARY_MARKERS]
        for marker in PRIMARY_MARKERS:
            marker_anywhere[marker] += text.count(marker)
        for marker in primary_sequence:
            marker_occurrences[marker] += 1
        for marker in set(primary_sequence):
            marker_entries[marker] += 1
        sequence_key = "".join(primary_sequence) or "none"
        marker_sequences[sequence_key] += 1
        add_sample(marker_sequence_samples, sequence_key, word)
        if "◯" in primary_sequence and any(x in NUMBERED_MARKERS for x in primary_sequence):
            marker_mixed += 1
        numbered = [NUMBERED_MARKERS.index(x) + 1 for x in primary_sequence if x in NUMBERED_MARKERS]
        if len(numbered) != len(set(numbered)):
            marker_repeated += 1
        if numbered and any(b > a + 1 for a, b in zip(numbered, numbered[1:])):
            marker_skip += 1
        if numbered and any(b <= a for a, b in zip(numbered, numbered[1:])):
            marker_restart += 1

        entry_nested = collections.Counter()
        for system, regex in (("circled-katakana", f"[{SUBSENSE_MARKERS}]"),
                              ("parenthesized-unicode", f"[{PAREN_NUMBER_CHARS}]")):
            found = re.findall(regex, text)
            marker_nested[system] += len(found)
            if found:
                entry_nested[system] += 1
                add_sample(marker_nested_samples, system, {"headword": word, "snippet": next(line for line in nonempty if any(x in line for x in found))})
        for system, regex in (("ascii-parentheses", ASCII_NUMBER_RE), ("square-brackets", SQUARE_NUMBER_RE)):
            found = regex.findall(text)
            marker_nested[system] += len(found)
            if found:
                entry_nested[system] += 1
                add_sample(marker_nested_samples, system, {"headword": word, "snippet": next(line for line in nonempty if regex.search(line))})
        for system in entry_nested:
            marker_nested_entries[system] += 1

        entry_pos = set()
        entry_diamond = set()
        entry_sections = set()
        note_seen = False
        local_example_count = 0
        classified = []
        has_initial_pos = bool(nonempty and re.fullmatch(r"【[^】]*】", nonempty[0]))
        for line_index, line in enumerate(nonempty):
            kind = line_kind(line, line_index, has_initial_pos)
            classified.append(kind)
            if kind == "RAW":
                unclassified_line_count += 1
            pos = re.fullmatch(r"【([^】]*)】", line)
            if pos:
                value = pos.group(1)
                pos_counts[value] += 1
                entry_pos.add(value)
                add_sample(pos_samples, value, word)
            if line.startswith("◈"):
                rest = line[1:]
                label = next((x for x in KNOWN_DIAMOND_LABELS if rest.startswith(x)), "(unlabeled)")
                diamond_labels[label] += 1
                entry_diamond.add(label)
                add_sample(diamond_samples, label, {"headword": word, "line": line})
                note_seen = True
            section = next((x for x in KNOWN_LINE_SECTIONS if line.startswith(x)), None)
            if section:
                section_counts[section] += 1
                entry_sections.add(section)
                position = "before-definition" if not primary_sequence else (
                    "after-last-definition" if line_index > max(i for i, x in enumerate(nonempty) if x[0] in PRIMARY_MARKERS) else "between-definitions")
                section_positions[(section, position)] += 1
                add_sample(section_samples, section, {"headword": word, "line": line})
                note_seen = True
                if section == "派生":
                    body = line[len(section):]
                    derivative_shapes["multiple-separators" if body.count("・") + body.count("、") + body.count(";") > 0 else "single-run"] += 1
                    add_sample(derivative_samples, "multiple-separators" if body.count("・") + body.count("、") + body.count(";") > 0 else "single-run", {"headword": word, "line": line})
            if line.startswith("▶"):
                section_counts["▶"] += 1
                entry_sections.add("▶")
                token = next((x for x in KNOWN_LINE_SECTIONS if line[1:].startswith(x)), "(unlabeled)")
                arrow_payload_prefix[token] += 1
                add_sample(arrow_samples, token, {"headword": word, "line": line})
                note_seen = True

            if line[0] in PRIMARY_MARKERS:
                category = "definition"
                marker_length = 1
            elif line.startswith("｢"):
                category = "example"
                marker_length = 1
                local_example_count += 1
                if note_seen:
                    examples_after_note += 1
                else:
                    examples_before_note += 1
            else:
                category = "other"
                marker_length = 0
            shape = slash_shape(line, marker_length)
            slash_counts[category][shape] += 1
            if "/" in line:
                add_sample(slash_samples[category], shape, {"headword": word, "line": line})

            for opening, closing in QUOTE_PAIRS.items():
                quote_counts[opening] += line.count(opening)
                quote_counts[closing] += line.count(closing)
            if line.startswith("｢"):
                example_delimiters["｢…｣"] += 1
                if line.count("｢") > 1 or line.count("｣") > 1:
                    example_delimiters["nested/multiple ｢…｣"] += 1
        for category, counter in slash_counts.items():
            present_shapes = set()
            for line in nonempty:
                if category == "definition" and line[0] in PRIMARY_MARKERS:
                    present_shapes.add(slash_shape(line, 1))
                elif category == "example" and line.startswith("｢"):
                    present_shapes.add(slash_shape(line, 1))
                elif category == "other" and line[0] not in PRIMARY_MARKERS and not line.startswith("｢") and "/" in line:
                    present_shapes.add(slash_shape(line, 0))
            for shape in present_shapes:
                slash_entries[category][shape] += 1
        for value in entry_pos:
            pass
        for value in entry_diamond:
            diamond_label_entries[value] += 1
        for value in entry_sections:
            section_entries[value] += 1
        example_counts[local_example_count] += 1

        for opening, closing in QUOTE_PAIRS.items():
            left, right = text.count(opening), text.count(closing)
            if left != right:
                key = f"{opening}{closing}: {left}/{right}"
                quote_entry_imbalances[key] += 1
                add_sample(quote_imbalance_samples, key, {"headword": word, "snippet": text[:500]})
        for opening, closing in BRACKET_PAIRS.items():
            left, right = text.count(opening), text.count(closing)
            bracket_counts[opening] += left
            bracket_counts[closing] += right
            if left != right:
                key = f"{opening}{closing}: {left}/{right}"
                bracket_entry_imbalances[key] += 1
                add_sample(bracket_imbalance_samples, key, {"headword": word, "snippet": text[:500]})
        for token in ARTIFACT_TOKENS:
            count = text.count(token)
            if count:
                artifact_counts[token] += count
                artifact_entries[token] += 1
                add_sample(artifact_samples, token, {"headword": word, "snippet": text[:500]})

        if nonempty:
            first = nonempty[0]
            if link_match:
                hp = "link-record"
                relation = "link-record"
            elif redirect_match:
                hp = "plain-redirect"
                relation = "plain-redirect"
            elif has_initial_pos:
                hp = "implicit-index-heading"
                relation = "payload-starts-with-pos"
            else:
                has_square = "［" in first and "］" in first
                has_hyphen = any(x in first for x in ("‐", "-", "―"))
                has_dot = "・" in first
                bracket_count = first.count("［")
                hp = "+".join(filter(None, ["explicit", "reading-orthography" if has_square else "plain", "multi-bracket" if bracket_count > 1 else "", "hyphen" if has_hyphen else "", "middle-dot" if has_dot else ""]))
                relation = "exact" if first == word else ("contains-index" if word in first else "different")
                add_sample(heading_relation_samples, relation, {"headword": word, "heading": first})
            heading_patterns[hp] += 1
            heading_relation[relation] += 1
            add_sample(heading_samples, hp, {"headword": word, "heading": first})

        if "RAW" in classified:
            entries_with_unclassified += 1
        shape = compact_sequence(classified)
        shape_counts[shape] += 1
        add_sample(shape_samples, shape, word)

        controls = [(c, f"U+{ord(c):04X}") for c in text if unicodedata.category(c) in {"Cc", "Cf"} and c not in "\n\r\t"]
        if controls:
            anomaly_counts["control-or-format"] += 1
            add_sample(anomaly_samples, "control-or-format", {"headword": word, "characters": controls[:10], "snippet": text[:500]})
        if "�" in text:
            anomaly_counts["replacement-character"] += 1
            add_sample(anomaly_samples, "replacement-character", {"headword": word, "snippet": text[:500]})
        if re.search(r"(?:Ã.|Â.)", text):
            anomaly_counts["mojibake-like"] += 1
            add_sample(anomaly_samples, "mojibake-like", {"headword": word, "snippet": text[:500]})
        for c in text:
            if ord(c) > 0xFFFF or unicodedata.category(c) in {"Co", "Cn", "Cs"}:
                codepoint_counts[(f"U+{ord(c):04X}", c, unicodedata.name(c, "UNNAMED"))] += 1

    for category, counter in slash_counts.items():
        for shape in counter:
            pass
    for value in pos_counts:
        pass

    longest_entries.sort(reverse=True)
    report = {
        "runtime_seconds": round(time.perf_counter() - started, 3),
        "files": {suffix: {"path": str(path), "bytes": path.stat().st_size, "sha256": sha256(path)} for suffix, path in paths.items()},
        "ifo": metadata,
        "container": {
            "offset_bits": offset_bits, "index_bytes": len(index_bytes), "payload_bytes": len(payload),
            "index_records": len(records), "index_consumed_bytes": index_result["consumed_bytes"],
            "index_parse_failures": index_result["failures"], "unique_headwords": len(headword_counts),
            "duplicate_headword_records": sum(n - 1 for n in headword_counts.values() if n > 1),
            "duplicate_headwords": [{"headword": w, "records": n} for w, n in headword_counts.most_common() if n > 1],
            "invalid_offsets": invalid_offsets, "invalid_sizes": invalid_sizes, "zero_lengths": zero_lengths,
            "payload_decode_failures": decode_failures, "minimum_size": min(sizes), "maximum_size": max(sizes),
            "median_size": statistics.median(sizes), "mean_size": statistics.mean(sizes),
            "max_resolved_end": max(offset + size for _, offset, size in records),
            "idx_oft": {"header": oft_bytes[:len(oft_header)].decode("ascii", errors="replace"),
                        "opaque_bytes_hex": oft_bytes[len(oft_header):len(oft_header) + 4].hex(),
                        "value_count": len(oft_values), "expected_value_count": len(expected_oft),
                        "mismatches": sum(a != b for a, b in zip(oft_values, expected_oft)) + abs(len(oft_values) - len(expected_oft)),
                        "error": oft_error},
        },
        "markers": {
            "primary": [{"marker": m, "structural_occurrences": marker_occurrences[m],
                         "all_text_occurrences": marker_anywhere[m], "entries": marker_entries[m]}
                        for m in PRIMARY_MARKERS if marker_occurrences[m] or marker_anywhere[m]],
            "sequence_count": len(marker_sequences),
            "common_sequences": examples(marker_sequences, marker_sequence_samples, 40),
            "mixed_circle_numbered_entries": marker_mixed, "repeated_number_entries": marker_repeated,
            "skipping_number_entries": marker_skip, "restart_or_decrease_entries": marker_restart,
            "nested": [{"system": x, "occurrences": marker_nested[x], "entries": marker_nested_entries[x], "examples": marker_nested_samples.get(x, [])} for x in marker_nested],
        },
        "pos": [{"raw": value, "occurrences": count, "headwords": pos_samples[value]} for value, count in pos_counts.most_common()],
        "diamond": [{"label": value, "occurrences": count, "entries": diamond_label_entries[value], "examples": diamond_samples[value]} for value, count in diamond_labels.most_common()],
        "sections": {
            "inventory": [{"marker": value, "occurrences": count, "entries": section_entries[value], "examples": section_samples.get(value, []) or arrow_samples.get(value, [])} for value, count in section_counts.most_common()],
            "positions": [{"marker": marker, "position": position, "count": count} for (marker, position), count in section_positions.most_common()],
            "arrow_categories": [{"category": value, "occurrences": count, "examples": arrow_samples[value]} for value, count in arrow_payload_prefix.most_common()],
            "derivative_shapes": [{"shape": value, "occurrences": count, "examples": derivative_samples[value]} for value, count in derivative_shapes.most_common()],
        },
        "slashes": {category: [{"shape": shape, "line_occurrences": count, "entries": slash_entries[category][shape], "examples": slash_samples[category].get(shape, [])} for shape, count in counter.most_common()] for category, counter in slash_counts.items()},
        "examples": {"entry_example_count_distribution": sorted(example_counts.items()), "before_notes": examples_before_note, "after_notes": examples_after_note, "delimiters": dict(example_delimiters)},
        "quotes": {"character_counts": dict(quote_counts), "imbalances": [{"pattern": key, "entries": count, "examples": quote_imbalance_samples[key]} for key, count in quote_entry_imbalances.most_common()]},
        "brackets": {"character_counts": dict(bracket_counts), "imbalances": [{"pattern": key, "entries": count, "examples": bracket_imbalance_samples[key]} for key, count in bracket_entry_imbalances.most_common()]},
        "headings": {
            "patterns": [{"pattern": x, "entries": n, "examples": heading_samples[x]} for x, n in heading_patterns.most_common()],
            "relations": [{"relation": x, "entries": n, "examples": heading_relation_samples.get(x, [])} for x, n in heading_relation.most_common()],
        },
        "links": {"counts": dict(link_counts), "samples": link_samples,
                  "plain_redirects": {"counts": dict(redirect_counts), "samples": redirect_samples}},
        "shapes": {
            "distinct": len(shape_counts), "unclassified_lines": unclassified_line_count, "entries_with_unclassified_lines": entries_with_unclassified,
            "top": [{"shape": shape, "entries": count, "examples": shape_samples[shape]} for shape, count in shape_counts.most_common(100)],
        },
        "anomalies": {
            "categories": [{"category": x, "entries": n, "examples": anomaly_samples[x]} for x, n in anomaly_counts.most_common()],
            "artifact_tokens": [{"token": x, "occurrences": n, "entries": artifact_entries[x], "examples": artifact_samples[x]} for x, n in artifact_counts.most_common()],
            "unusual_codepoints": [{"codepoint": cp, "character": c, "name": name, "occurrences": n} for (cp, c, name), n in codepoint_counts.most_common()],
        },
        "longest": [{"headword": word, "bytes": size, "raw": text} for size, word, text in longest_entries[:10]],
        "selected": selected,
        "coverage": {"records_decoded": len(decoded), "records_total": len(records)},
    }
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()

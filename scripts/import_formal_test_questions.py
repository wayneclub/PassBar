#!/usr/bin/env python3
"""Dry-run audit for formal-test MBE PDFs.

The command extracts only structurally complete records, verifies answer-key
letters, detects same-subject matches against enriched JSON, and writes a
review report. It never changes enriched JSON.
"""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import os
import re
import subprocess
import unicodedata
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
FORMAL = ROOT / "formal test"
OUT = ROOT / "out"
KEYS = ("A", "B", "C", "D")
SUBJECTS = (
    "Civil Procedure", "Constitutional Law", "Contracts",
    "Criminal Law and Procedure", "Evidence", "Real Property", "Torts",
)

# The Civil Procedure 2021 answer-key PDF includes an explicit outline entry
# after every explanation. These are the corresponding canonical chapter names
# used by the existing enriched bank. Other source PDFs identify a subject but
# do not attach a chapter to each individual question.
CIVIL_2021_CHAPTERS = {
    1: "Jurisdiction and Venue", 2: "Jurisdiction and Venue",
    3: "Jurisdiction and Venue", 4: "Jurisdiction and Venue",
    5: "Law Applied by Federal Courts",
    6: "Pretrial Procedures", 7: "Pretrial Procedures",
    8: "Pretrial Procedures", 9: "Pretrial Procedures",
    10: "Jury Trials",
    11: "Motions", 12: "Motions", 13: "Motions",
    14: "Verdicts and Judgments", 15: "Verdicts and Judgments",
    16: "Appealability and Review",
}


@dataclass
class Question:
    file: str
    sha256: str
    number: int
    subject: str
    stem: str
    choices: dict[str, str]
    answer: str
    source_type: str

    @property
    def id(self) -> str:
        return f"{self.file}::{self.subject}#{self.number}"


@dataclass
class Existing:
    file: Path
    index: int
    subject: str
    chapter: str
    stem: str
    choices: dict[str, str]
    answer: str

    @property
    def id(self) -> str:
        return f"{self.file.relative_to(ROOT)}#{self.index}"


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def text(path: Path) -> str:
    return subprocess.run(
        ["pdftotext", "-raw", str(path), "-"],
        check=True, capture_output=True, text=True,
    ).stdout.replace("\x0c", "\n")


def layout_text(path: Path) -> str:
    """Extract positioned PDF text, preserving page breaks and columns."""
    return subprocess.run(
        ["pdftotext", "-layout", str(path), "-"],
        check=True, capture_output=True, text=True,
    ).stdout


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


@lru_cache(maxsize=20_000)
def norm(value: str) -> str:
    """Canonical form for similarity: content only, never punctuation glyphs."""
    if "\x03" in value:
        value = repair_shifted_pdf_text(value)
    value = unicodedata.normalize("NFKD", value).lower().replace("\u00a0", " ")
    # Possessive and contraction glyphs are never a matching signal. All other
    # punctuation (including dashes and slashes) is converted to whitespace by
    # the final character-class replacement below.
    value = value.replace("'", "").replace("’", "").replace("`", "").replace("´", "")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value)).strip()


@lru_cache(maxsize=20_000)
def norm_tokens(value: str) -> frozenset[str]:
    """Cache retrieval tokens; matching compares every source to one subject."""
    return frozenset(norm(value).split())


def normalize_option_markers(value: str) -> str:
    """Repair the four damaged option glyphs used in parts of the 7-Day PDFs.

    The PDFs' text layer maps A-D to $, %, &, and ' on some pages.  This
    replacement is deliberately line-anchored, so those symbols in a fact
    pattern are never changed.
    """
    mapping = {"$": "A", "%": "B", "&": "C", "'": "D"}
    return re.sub(
        r"(?m)^\s*([$%&'])\s+(?:\x03)?",
        lambda match: f"({mapping[match.group(1)]}) ",
        value,
    )


def repair_shifted_pdf_text(value: str) -> str:
    """Decode shifted 7-Day PDF runs that carry its control separator.

    This PDF's text layer substitutes a few encrypted glyphs (``:`` for
    ``Z``, ``6`` for ``V``, and ``%`` for ``E``) in addition to the +3 Caesar
    shift. Decode only runs with ``\x03`` so ordinary source text is untouched.
    """
    # NCBE PDFs contain ordinary all-caps legal terms (for example,
    # ``TRESPASSING``).  The Caesar repair is exclusively for the damaged
    # 7-Day text layer, which is identifiable by its control separators.
    if "\x03" not in value and not re.search(r"[\x0f\x11\x13-\x1b]", value):
        plain = re.sub(r"[ \t]{2,}", " ", value)
        plain = re.sub(
            r"(?:\s+(?:Civil Procedure|Constitutional Law|Contracts|Criminal Law and Procedure|Evidence|Real Property|Torts)(?:\s+\d+)?)+\s*$",
            "", plain,
        )
        return re.sub(r"(?<=\w)-\s+(?=[a-z])", "-", plain)

    def decode(match: re.Match[str]) -> str:
        decoded: list[str] = []
        for char in match.group(0):
            if char == "\x03":
                decoded.append(" ")
            elif char == ":":
                decoded.append("W")
            elif char == "6":
                decoded.append("S")
            elif char == "%":
                decoded.append("B")
            elif char == "¶":
                decoded.append("’")
            elif "D" <= char <= "]":
                decoded.append(chr(ord(char) - 3))
            else:
                decoded.append(char)
        result = "".join(decoded).lower()
        prefix = value[:match.start()].rstrip()
        if not prefix or prefix[-1] in ".?!" or re.search(r"\([A-D]\)$", prefix):
            result = result[:1].upper() + result[1:]
        return result
    repaired = re.sub(r"[A-Z\\\]¶:6%]*\x03[A-Z\\\]¶:6%\x03]*", decode, value)
    repaired = repaired.replace("\x11", ". ").replace("\x0f", ", ")
    repaired = repaired.translate(str.maketrans({
        "\x04": "!", "\x07": "$", "\x08": "%", "\x13": "0",
        "\x14": "1", "\x15": "2", "\x18": "5", "\x1b": "8",
    }))
    repaired = repaired.replace("¶", "’").replace("³", "“").replace("´", "”")
    repaired = re.sub(r"(?<!\w)\$(?=[a-z’'])", "A", repaired)
    repaired = re.sub(r"(?<!\w)\$\s+(?=[a-z])", "A ", repaired)
    repaired = re.sub(r"(?<!\w)7(?=[a-z])", "T", repaired)
    repaired = re.sub(r"(?<=[A-Za-z])\[", "x", repaired)
    repaired = re.sub(r"(?<!\w)1R\b", "No", repaired)
    repaired = re.sub(r"(?<!\w)2n\b", "On", repaired)
    repaired = re.sub(r"(?<!\w)8s\b", "Us", repaired)
    repaired = re.sub(r"(?<!\w)<ou\b", "You", repaired)
    repaired = re.sub(r"(?<!\w),s\b", "Is", repaired)
    repaired = repaired.replace("2ND\\", "Okay").replace(":D\\", "Way")
    repaired = repaired.replace("2QO\\", "Only").replace("2XW", "Out")
    repaired = repaired.replace(".Eep", "Keep").replace("*rant", "Grant")
    repaired = repaired.replace("3edestrian", "Pedestrian").replace("5ight", "Right")
    repaired = repaired.replace("-une", "June").replace("8naware", "Unaware")
    repaired = repaired.replace("*reat", "Great").replace("3olice", "Police")

    def decode_unmarked_word(match: re.Match[str]) -> str:
        result = "".join(chr(ord(char) - 3) for char in match.group(0)).lower()
        prefix = repaired[:match.start()].rstrip()
        if not prefix or prefix[-1] in ".?!“”":
            result = result[:1].upper() + result[1:]
        return result

    repaired = re.sub(r"[D-Z\\\]]{4,}", decode_unmarked_word, repaired)
    # A second font map mixes a leading glyph with otherwise decoded text.
    # Apply these after unmarked Caesar runs (for example, 5LJKW -> 5ight).
    repaired = repaired.replace("<HV", "Yes").replace("YeV", "Yes")
    # Some encrypted words begin with a glyph that cannot be safely decoded
    # generically because the same glyph is also used for a number elsewhere.
    # These replacements are verified against rendered source pages.
    repaired = repaired.replace("5HQW", "Rent").replace("0arch", "March")
    repaired = repaired.replace("1othing", "Nothing").replace("0inutes", "Minutes")
    repaired = repaired.replace("SUH-need", "pre-need")
    repaired = repaired.replace("basH", "base").replace("selleU", "seller")
    repaired = repaired.replace("8&&", "UCC")
    repaired = re.sub(r"(?<!\w),n\b", "In", repaired)
    repaired = re.sub(r"(?<!\w),f\b", "If", repaired)
    repaired = re.sub(r"(?<!\w)\+(?=ow\b)", "H", repaired)
    repaired = re.sub(r"\$(\d+),\s+(\d{3})", r"$\1,\2", repaired)
    repaired = re.sub(r"([.!?])\s+”", r"\1”", repaired)
    repaired = re.sub(r"(?<=” )without\b", "Without", repaired)
    repaired = re.sub(r"(?<!\w)&(?=[a-z])", "C", repaired)
    repaired = re.sub(r"(?<!\w)[35](?=[a-z])", lambda match: "P" if match.group(0) == "3" else "R", repaired)
    repaired = re.sub(r"(?<!\w)8(?=[a-z])", "U", repaired)
    repaired = re.sub(r"(?<!\w)\*(?=[a-z])", "G", repaired)
    repaired = re.sub(r"(?<!\w)\)(?=[a-z])", "F", repaired)
    repaired = re.sub(r"(?<!\w)\((?=[a-z])", "E", repaired)
    repaired = re.sub(r"(?<!\w)'(?=[a-z])", "D", repaired)
    repaired = re.sub(r"(?<!\w)\.(?=eep\b)", "K", repaired)
    repaired = repaired.replace(">", "").replace("@", "")
    repaired = repaired.replace("Hxamination", "Examination")
    repaired = repaired.replace("cross-Examination", "cross-examination")
    repaired = repaired.replace("fiancpH", "fiancée").replace("fiancpe", "fiancée")
    repaired = repaired.replace(",’m", "I’m").replace("/ater", "Later")
    repaired = re.sub(r"\bState([A-Z])\b", r"State \1", repaired)
    repaired = re.sub(r"(?<=“), (?=[a-z])", "I ", repaired)
    repaired = re.sub(r",s(?=n[’'])", "Is", repaired)
    repaired = repaired.replace('"”', "”")
    repaired = re.sub(
        r"(?:\s+(?:Civil Procedure|Constitutional Law|Contracts|Criminal Law and Procedure|Evidence|Real Property|Torts)(?:\s+\d+)?)+\s*$",
        "", repaired,
    )
    repaired = re.sub(r"(?<=\w)-\s+(?=[a-z])", "-", repaired)
    return re.sub(r"[ \t]{2,}", " ", repaired)


def repair_question_stem(value: str) -> str:
    """Repair a damaged terminal question-mark glyph in 7-Day stems only."""
    repaired = repair_shifted_pdf_text(value)
    return re.sub(r'(?<=[A-Za-z])"$', "?", repaired)


def standardize_review_punctuation(value: str) -> str:
    """Use enriched punctuation and remove repeated PDF page footers."""
    standardized = value.translate(str.maketrans({
        "‘": "'", "’": "'", "“": '"', "”": '"',
    }))
    return strip_ncbe_page_footer(standardized)


def strip_ncbe_page_footer(value: str) -> str:
    """Remove the NCBE header copied onto the final option of each PDF page."""
    return re.sub(
        r"\s+National Conference of Bar Examiners\s+Multistate Bar Examination\s+-\s+Online Practice Exam\s+\d+\s*$",
        "", value,
    )


def source_fingerprint(question: Question) -> str:
    payload = norm(question.stem) + "|" + "|".join(norm(question.choices[k]) for k in KEYS)
    return hashlib.sha256(payload.encode()).hexdigest()


def split_choices(block: str) -> tuple[str, dict[str, str]] | None:
    marks = list(re.finditer(r"(?m)^\s*(?:\(([A-D])\)|([A-D])\.)\s*", block))
    all_marks = [(mark.group(1) or mark.group(2), mark.start(), mark.end()) for mark in marks]
    deduped = next(
        (all_marks[position:position + 4] for position in range(len(all_marks) - 3)
         if [item[0] for item in all_marks[position:position + 4]] == list(KEYS)),
        None,
    )
    if deduped is None:
        return None
    choices: dict[str, str] = {}
    for i, (key, _, content_start) in enumerate(deduped):
        content_end = deduped[i + 1][1] if i + 1 < len(deduped) else len(block)
        choices[key] = clean(block[content_start:content_end])
    stem = clean(block[:deduped[0][1]])
    return (stem, choices) if stem and all(choices.values()) else None


def answer_pairs(value: str) -> dict[int, str]:
    return {int(number): letter for number, letter in re.findall(r"\b(\d{1,3})\.\s*([A-D])\b", value)}


def records_from_blocks(
    source: Path, subject: str, source_type: str, body: str,
    marker: re.Pattern[str], answers: dict[int, str],
) -> tuple[list[Question], list[str]]:
    records: list[Question] = []
    errors: list[str] = []
    marks = list(marker.finditer(body))
    file_digest = digest(source)
    for pos, mark in enumerate(marks):
        number = int(mark.group("number"))
        end = marks[pos + 1].start() if pos + 1 < len(marks) else len(body)
        block = normalize_option_markers(body[mark.end():end].split("Solution:", 1)[0])
        parsed = split_choices(block)
        if not parsed:
            errors.append(f"{source.name} #{number}: unable to parse four choices")
            continue
        if answers.get(number) not in KEYS:
            errors.append(f"{source.name} #{number}: missing answer-key letter")
            continue
        stem, choices = parsed
        records.append(Question(
            file=str(source.relative_to(ROOT)), sha256=file_digest, number=number,
            subject=subject, stem=stem, choices=choices, answer=answers[number],
            source_type=source_type,
        ))
    return records, errors


def parse_7_day(path: Path) -> tuple[list[Question], int, list[str]]:
    subject = re.search(r"\((.+)\)\.pdf$", path.name).group(1)
    raw = text(path)
    answer_headers = list(re.finditer(r"Answer\s*Key", raw, re.I))
    if not answer_headers:
        return [], 0, [f"{path.name}: answer key not found"]
    header = answer_headers[-1]
    body, key = raw[:header.start()], raw[header.end():]
    answers = answer_pairs(key)
    records, errors = records_from_blocks(
        path, subject, "7-day", body,
        re.compile(r"Question\s*#\s*(?P<number>\d+)", re.I), answers,
    )
    return records, len(answers), errors


def parse_civil_2021(path: Path) -> tuple[list[Question], int, list[str]]:
    raw = text(path)
    answers = {
        int(number): letter
        for number, letter in re.findall(
            r"Question\s*#\s*(\d+).*?Solution:\s*The correct answer is ([A-D])\.",
            raw, re.S,
        )
    }
    records, errors = records_from_blocks(
        path, "Civil Procedure", "civil-procedure-2021", raw,
        re.compile(r"Question\s*#\s*(?P<number>\d+)", re.I), answers,
    )
    return records, len(answers), errors


def parse_ncbe(path: Path) -> tuple[list[Question], int, list[str]]:
    raw = text(path)
    marker = re.compile(r"Question\s*#\s*(?P<number>\d+)\s*-\s*(?P<subject>[^\n]+)", re.I)
    answer_marks = list(marker.finditer(raw))
    answers: dict[int, str] = {}
    for pos, mark in enumerate(answer_marks):
        end = answer_marks[pos + 1].start() if pos + 1 < len(answer_marks) else len(raw)
        block = raw[mark.end():end]
        direct = re.search(r"\(([A-D])\)\s+Correct\.", block)
        if direct:
            answers[int(mark.group("number"))] = direct.group(1)
            continue
        option_marks = list(re.finditer(r"(?m)^\s*\(([A-D])\)\s+", block))
        for option_pos, option in enumerate(option_marks):
            option_end = option_marks[option_pos + 1].start() if option_pos + 1 < len(option_marks) else len(block)
            if re.search(r"(?m)^\s*Correct\.", block[option.end():option_end]):
                answers[int(mark.group("number"))] = option.group(1)
                break

    question_path = path.with_name(path.name.replace("Answers", "Questions"))
    question_text = text(question_path)
    question_marks = list(marker.finditer(question_text))
    records: list[Question] = []
    errors: list[str] = []
    file_digest = digest(path)
    for pos, mark in enumerate(question_marks):
        number = int(mark.group("number"))
        end = question_marks[pos + 1].start() if pos + 1 < len(question_marks) else len(question_text)
        parsed = split_choices(strip_ncbe_page_footer(question_text[mark.end():end]))
        if not parsed:
            errors.append(f"{path.name} #{number}: unable to parse four choices")
            continue
        if answers.get(number) not in KEYS:
            errors.append(f"{path.name} #{number}: missing answer-key letter")
            continue
        stem, choices = parsed
        records.append(Question(
            file=str(path.relative_to(ROOT)), sha256=file_digest, number=number,
            subject=mark.group("subject").strip(), stem=stem, choices=choices,
            answer=answers[number], source_type="ncbe-online-practice",
        ))
    return records, len(answers), errors


def layout_210_question_blocks(path: Path) -> list[tuple[int, str, dict[str, str]]]:
    """Read the two-column 210-question PDF without joining adjacent words.

    Its ``-raw`` text stream loses word boundaries at column glyph changes.
    Each question page has exactly two headers, so their physical positions
    provide a reliable column split without OCR or heuristic word splitting.
    """
    blocks: list[tuple[int, str, dict[str, str]]] = []
    footer = re.compile(
        r"^\s*(?:\d+|(?:Civil Procedure|Constitutional Law|Contracts|Criminal Law and Procedure|Evidence|Real Property|Torts)(?:\s+\d+)?)\s*$"
    )
    for page in layout_text(path).split("\x0c"):
        lines = page.splitlines()
        header_offsets = sorted(
            match.start()
            for line in lines
            for match in re.finditer(r"Question\s+\d+\.", line)
        )
        if len(header_offsets) < 2:
            continue
        column_break = header_offsets[1]
        columns = (
            "\n".join(line[:column_break].rstrip() for line in lines),
            "\n".join(line[column_break:].rstrip() for line in lines),
        )
        for column in columns:
            column = "\n".join(line for line in column.splitlines() if not footer.match(line))
            # Preserve a word that was hyphenated solely because it wrapped at
            # the end of a PDF line (for example, ``four-year-\nold``).
            column = re.sub(r"(?<=\w)-\n\s*(?=[a-z])", "-", column)
            column = column.replace("case-in- chief", "case-in-chief")
            markers = list(re.finditer(r"(?m)^\s*Question\s+(?P<number>\d+)\.", column))
            for pos, marker in enumerate(markers):
                end = markers[pos + 1].start() if pos + 1 < len(markers) else len(column)
                parsed = split_choices(column[marker.end():end])
                if parsed:
                    stem, choices = parsed
                    blocks.append((int(marker.group("number")), stem, choices))
    return blocks


def parse_210(path: Path) -> tuple[list[Question], int, list[str]]:
    raw = text(path)
    records: list[Question] = []
    errors: list[str] = []
    pdf_labels = {
        "Civil Procedure": "CivilProcedure",
        "Constitutional Law": "ConstitutionalLaw",
        "Contracts": "Contracts",
        "Criminal Law and Procedure": "Criminal Law and Procedure",
        "Evidence": "Evidence",
        "Real Property": "RealProperty",
        "Torts": "Torts",
    }
    displayed_blocks = layout_210_question_blocks(path)
    if len(displayed_blocks) != 210:
        return [], 210, [f"210-Questions.pdf: expected 210 positioned question blocks, found {len(displayed_blocks)}"]
    for subject_position, (subject, label) in enumerate(pdf_labels.items()):
        question_start = re.search(
            rf"(?ms)^{re.escape(label)}\s+\d+\s*$.*?^(?P<question>Question\s+1\.)",
            raw,
        )
        if not question_start:
            errors.append(f"210-Questions.pdf {subject}: question section not found")
            continue
        answer_start = re.search(
            rf"{re.escape(subject).replace(r'\ ', r'\s*')}\s*Answer\s*Key",
            raw[question_start.end():],
        )
        if not answer_start:
            errors.append(f"210-Questions.pdf {subject}: answer key not found")
            continue
        answer_offset = question_start.end() + answer_start.start()
        answers = dict(list(answer_pairs(raw[answer_offset:answer_offset + 1500]).items())[:30])
        start = subject_position * 30
        section_blocks = displayed_blocks[start:start + 30]
        numbers = [number for number, _, _ in section_blocks]
        if numbers != list(range(1, 31)):
            errors.append(f"210-Questions.pdf {subject}: positioned question numbers are invalid")
            continue
        for number, stem, choices in section_blocks:
            if answers.get(number) not in KEYS:
                errors.append(f"210-Questions.pdf {subject} #{number}: missing answer-key letter")
                continue
            records.append(Question(
                file=str(path.relative_to(ROOT)), sha256=digest(path), number=number,
                subject=subject, stem=stem, choices=choices, answer=answers[number],
                source_type="ncbe-210-study-aid",
            ))
        if len(answers) != 30:
            errors.append(f"210-Questions.pdf {subject}: expected 30 answers, found {len(answers)}")
    seen = {record.subject for record in records}
    missing = set(SUBJECTS) - seen
    if missing:
        errors.append("210-Questions.pdf: missing subjects " + ", ".join(sorted(missing)))
    return records, 210, errors


def existing_questions() -> list[Existing]:
    result: list[Existing] = []
    for path in sorted(OUT.rglob("*_enriched.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        for item in raw.get("questions", raw) if isinstance(raw, dict) else raw:
            choices = {key.upper(): str(value) for key, value in (item.get("choices") or {}).items()}
            if set(choices) != set(KEYS):
                continue
            result.append(Existing(
                file=path, index=int(item["index"]), subject=str(item["subject"]),
                chapter=str(item["chapter"]), stem=str(item["question"]),
                choices=choices, answer=str(item["answer"]).upper(),
            ))
    return result


def similarity(source: Question, target: Existing) -> float:
    stem = SequenceMatcher(None, norm(source.stem), norm(target.stem)).ratio()
    choices = SequenceMatcher(
        None, "|".join(norm(source.choices[k]) for k in KEYS),
        "|".join(norm(target.choices[k]) for k in KEYS),
    ).ratio()
    return round(0.70 * stem + 0.30 * choices, 6)


def mapped_correct_choice(source: Question, target: Existing) -> tuple[str | None, float]:
    """Map the official source answer text to the candidate's option ordering."""
    source_answer_text = norm(source.choices[source.answer])
    scored = [
        (SequenceMatcher(None, source_answer_text, norm(target.choices[key])).ratio(), key)
        for key in KEYS
    ]
    score, key = max(scored)
    return (key, round(score, 6)) if score >= 0.90 else (None, round(score, 6))


def verified_variant_score(source: Question, target: Existing) -> float | None:
    """Accept a wording/order variant only when all answer content still agrees."""
    stem = SequenceMatcher(None, norm(source.stem), norm(target.stem)).ratio()
    matrix = [[SequenceMatcher(None, norm(source.choices[a]), norm(target.choices[b])).ratio() for b in KEYS] for a in KEYS]
    permutation = max(itertools.permutations(range(4)), key=lambda p: sum(matrix[i][p[i]] for i in range(4)))
    values = [matrix[i][permutation[i]] for i in range(4)]
    answer_index = KEYS.index(source.answer)
    mapped_answer = KEYS[permutation[answer_index]]
    if mapped_answer != target.answer or values[answer_index] < 0.80:
        return None
    mean, minimum = sum(values) / 4, min(values)
    if not ((stem >= 0.80 and mean >= 0.90 and minimum >= 0.70) or (stem >= 0.60 and mean >= 0.96 and minimum >= 0.90)):
        return None
    return round(0.55 * stem + 0.45 * mean, 6)


def candidate_matches(source: Question, candidates: list[Existing]) -> list[tuple[float, Existing]]:
    source_tokens = norm_tokens(source.stem)
    lexical: list[tuple[float, Existing]] = []
    for candidate in candidates:
        target_tokens = norm_tokens(candidate.stem)
        # Use a cheap retrieval score first; only the most plausible candidates
        # receive the O(n²) sequence comparison below.
        overlap = len(source_tokens & target_tokens) / max(1, min(len(source_tokens), len(target_tokens)))
        if overlap >= 0.18:
            lexical.append((overlap, candidate))
    return sorted(
        ((similarity(source, candidate), candidate) for _, candidate in sorted(lexical, reverse=True, key=lambda item: item[0])[:25]),
        key=lambda item: item[0],
        reverse=True,
    )[:3]


def source_json(question: Question) -> dict[str, Any]:
    result = asdict(question)
    result["id"] = question.id
    return result


def source_metadata(question: dict[str, Any]) -> dict[str, Any]:
    """Return only classification evidence explicitly present in a source."""
    source_type = question["source_type"]
    if source_type == "7-day":
        subject_evidence = "filename and PDF cover title"
    elif source_type == "ncbe-online-practice":
        subject_evidence = "per-question document heading"
    elif source_type == "ncbe-210-study-aid":
        subject_evidence = "PDF subject section heading"
    else:
        subject_evidence = "document outline annotation"

    chapter = None
    chapter_evidence = None
    if source_type == "civil-procedure-2021":
        chapter = CIVIL_2021_CHAPTERS.get(question["number"])
        chapter_evidence = "per-question Civil Procedure outline annotation"

    return {
        "subject_verified": True,
        "subject_evidence": subject_evidence,
        "chapter": chapter,
        "chapter_evidence": chapter_evidence,
    }


def run(report_path: Path) -> int:
    inventory: list[dict[str, Any]] = []
    all_records: list[Question] = []
    all_errors: list[str] = []

    parse_jobs = [
        *(("7-day", path, parse_7_day) for path in sorted((FORMAL / "7 day questions ").glob("*.pdf"))),
        ("civil-procedure-2021", FORMAL / "civil procedure" / "CivilProcedure2021_Answer-Keys.pdf", parse_civil_2021),
        ("ncbe-210-study-aid", FORMAL / "210-Questions.pdf", parse_210),
        *(("ncbe-online-practice", path, parse_ncbe) for path in sorted((FORMAL / "NCBE Online Practice Exam 1-4 ").glob("* Answers.pdf"))),
    ]
    for source_type, path, parser in parse_jobs:
        records, expected, errors = parser(path)
        all_records.extend(records)
        all_errors.extend(errors)
        inventory.append({
            "type": source_type, "file": str(path.relative_to(ROOT)),
            "sha256": digest(path), "expected_count": expected,
            "extracted_count": len(records), "errors": errors,
        })
        if expected != len(records):
            all_errors.append(f"{path.name}: expected {expected}, extracted {len(records)}")

    existing = existing_questions()
    by_subject: dict[str, list[Existing]] = defaultdict(list)
    for question in existing:
        by_subject[question.subject].append(question)

    duplicate_groups: dict[str, list[Question]] = defaultdict(list)
    for question in all_records:
        duplicate_groups[source_fingerprint(question)].append(question)

    accepted: list[dict[str, Any]] = []
    review: list[dict[str, Any]] = []
    for question in all_records:
        candidates = candidate_matches(question, by_subject.get(question.subject, []))
        evaluated = [
            (score, candidate, *mapped_correct_choice(question, candidate), verified_variant_score(question, candidate))
            for score, candidate in candidates
        ]
        good = [
            (variant_score if variant_score is not None else score, candidate, mapped_letter, mapped_score)
            for score, candidate, mapped_letter, mapped_score, variant_score in evaluated
            if mapped_letter and candidate.answer == mapped_letter and (score >= 0.90 or variant_score is not None)
        ]
        conflicts = [
            (score, candidate, mapped_letter, mapped_score)
            for score, candidate, mapped_letter, mapped_score, _ in evaluated
            if score >= 0.90 and mapped_letter and candidate.answer != mapped_letter
        ]
        candidate_data = [{
            "score": score, "enriched": candidate.id, "chapter": candidate.chapter,
            "answer": candidate.answer, "source_answer_maps_to": mapped_letter,
            "answer_choice_similarity": mapped_score,
        } for score, candidate, mapped_letter, mapped_score, _ in evaluated]
        if len(good) == 1 and not conflicts:
            score, target, mapped_letter, mapped_score = good[0]
            accepted.append({
                "source": source_json(question), "enriched": target.id,
                "subject": target.subject, "chapter": target.chapter,
                "score": score, "source_answer_maps_to": mapped_letter,
                "answer_choice_similarity": mapped_score, "action": "add_official_exam_tag",
            })
        else:
            review.append({
                "source": source_json(question),
                "reason": "answer_conflict" if conflicts else ("ambiguous_match" if len(good) > 1 else "no_existing_match"),
                "candidates": candidate_data,
            })

    duplicates = [{
        "fingerprint": fingerprint,
        "answer_letters": sorted({question.answer for question in group}),
        "records": [question.id for question in group],
    } for fingerprint, group in duplicate_groups.items() if len(group) > 1]
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "dry_run",
        "source_inventory": inventory,
        "parse_errors": all_errors,
        "source_records": len(all_records),
        "existing_records": len(existing),
        "accepted_matches": len(accepted),
        "needs_review": len(review),
        "source_duplicate_groups": len(duplicates),
        "source_duplicate_answer_conflicts": sum(len(item["answer_letters"]) > 1 for item in duplicates),
        "matches": accepted,
        "needs_review_records": review,
        "source_duplicates": duplicates,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Report: {report_path.relative_to(ROOT)}")
    print(f"Extracted: {len(all_records)} source questions; existing: {len(existing)}")
    print(f"Parse errors: {len(all_errors)}")
    print(f"Accepted tags: {len(accepted)}; review queue: {len(review)}")
    print(f"Source duplicate groups: {len(duplicates)}")
    return 1 if all_errors else 0


def apply_verified_tags(report_path: Path) -> int:
    """Apply only the already-approved tag operations from a zero-error report."""
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report["parse_errors"]:
        raise RuntimeError("Refusing to write: the report has parse errors.")
    targets: dict[Path, dict[int, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for match in report["matches"]:
        rel_file, raw_index = match["enriched"].rsplit("#", 1)
        provenance = {
            "source_file": match["source"]["file"],
            "source_question_number": match["source"]["number"],
            "source_sha256": match["source"]["sha256"],
            "match_score": match["score"],
            "source_answer": match["source"]["answer"],
            "source_answer_maps_to": match["source_answer_maps_to"],
            "answer_choice_similarity": match["answer_choice_similarity"],
            "tagged_at": datetime.now(timezone.utc).isoformat(),
        }
        targets[ROOT / rel_file][int(raw_index)].append(provenance)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    files_changed = questions_tagged = provenance_added = 0
    for path, by_index in targets.items():
        document = json.loads(path.read_text(encoding="utf-8"))
        items = document.get("questions", document) if isinstance(document, dict) else document
        if len({item.get("index") for item in items}) != len(items):
            raise RuntimeError(f"Refusing to write {path}: duplicate question indices.")
        changed = False
        for item in items:
            index = item.get("index")
            if index not in by_index:
                continue
            tags = item.get("tags", [])
            if not isinstance(tags, list):
                raise RuntimeError(f"Refusing to write {path} #{index}: tags is not a list.")
            if "official_exam" not in tags:
                item["tags"] = [*tags, "official_exam"]
                questions_tagged += 1
                changed = True
            provenance = item.get("formal_test_provenance", [])
            if not isinstance(provenance, list):
                raise RuntimeError(f"Refusing to write {path} #{index}: provenance is not a list.")
            existing_keys = {
                (entry.get("source_file"), entry.get("source_question_number"))
                for entry in provenance if isinstance(entry, dict)
            }
            for entry in by_index[index]:
                key = (entry["source_file"], entry["source_question_number"])
                if key not in existing_keys:
                    provenance.append(entry)
                    existing_keys.add(key)
                    provenance_added += 1
                    changed = True
            item["formal_test_provenance"] = provenance
        if not changed:
            continue
        # Keep a per-file recovery copy, then atomically replace only validated JSON.
        backup = path.with_suffix(path.suffix + f".formal-test-{timestamp}.bak")
        backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
        temporary = path.with_suffix(path.suffix + ".formal-test.tmp")
        rendered = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
        temporary.write_text(rendered, encoding="utf-8")
        reloaded = json.loads(temporary.read_text(encoding="utf-8"))
        reloaded_items = reloaded.get("questions", reloaded) if isinstance(reloaded, dict) else reloaded
        if len({item.get("index") for item in reloaded_items}) != len(reloaded_items):
            raise RuntimeError(f"Generated invalid index set for {path}.")
        os.replace(temporary, path)
        files_changed += 1
    print(f"Applied official_exam tags to {questions_tagged} questions in {files_changed} enriched files.")
    print(f"Added {provenance_added} formal-test provenance records.")
    return 0


def export_review_json(report_path: Path, output_path: Path) -> int:
    """Create a non-importable enriched-shaped review artifact from the dry run."""
    report = json.loads(report_path.read_text(encoding="utf-8"))
    decisions: dict[str, dict[str, Any]] = {}
    for match in report["matches"]:
        decisions[match["source"]["id"]] = {
            "status": "matched_existing",
            "existing_question": match["enriched"],
            "match_score": match["score"],
            "chapter": match["chapter"],
            "answer_verified": True,
        }
    for pending in report["needs_review_records"]:
        decision = {
            "status": pending["reason"],
            "existing_question": None,
            "match_score": None,
            "chapter": None,
            "answer_verified": False,
        }
        if pending["candidates"]:
            candidate = pending["candidates"][0]
            decision["nearest_candidate"] = candidate
        decisions[pending["source"]["id"]] = decision

    questions: list[dict[str, Any]] = []
    for index, source_id in enumerate(sorted(decisions), start=1):
        source = (
            next(match["source"] for match in report["matches"] if match["source"]["id"] == source_id)
            if decisions[source_id]["status"] == "matched_existing"
            else next(item["source"] for item in report["needs_review_records"] if item["source"]["id"] == source_id)
        )
        review = decisions[source_id]
        metadata = source_metadata(source)
        source_chapter = metadata["chapter"]
        if source_chapter and review["chapter"] and review["chapter"] != source_chapter:
            raise RuntimeError(
                f"Source chapter disagrees with matched enriched chapter for {source_id}: "
                f"{source_chapter!r} != {review['chapter']!r}"
            )
        review["source_chapter"] = source_chapter
        review["source_chapter_verified"] = bool(source_chapter)
        questions.append({
            "index": index,
            "subject": source["subject"],
            # Blank is intentional: this file cannot be imported before the user
            # confirms/assigns a chapter for each unmatched question.
            "chapter": review["chapter"] or source_chapter or "",
            "topic": None,
            "count": len(decisions),
            "question": standardize_review_punctuation(repair_question_stem(source["stem"])),
            "choices": {
                key: standardize_review_punctuation(repair_shifted_pdf_text(value))
                for key, value in source["choices"].items()
            },
            "answer": source["answer"],
            "tags": ["official_exam"],
            "source_document": {
                "file": source["file"],
                "format": Path(source["file"]).suffix.lstrip(".").lower(),
                "source_type": source["source_type"],
            },
            "source_metadata": metadata,
            "formal_test_provenance": [{
                "source_file": source["file"],
                "source_question_number": source["number"],
                "source_sha256": source["sha256"],
                "source_type": source["source_type"],
            }],
            "review": review,
        })
    document = {
        "meta": {
            "schema": "passbar.formal-test.review.v1",
            "importable": False,
            "count": len(questions),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "note": "Review artifact only. Do not move or rename this file into out/.",
            "source_metadata_audit": {
                "subject_verified": len(questions),
                "explicit_question_chapter_verified": sum(
                    item["source_metadata"]["chapter"] is not None for item in questions
                ),
                "question_level_chapter_unavailable": sum(
                    item["source_metadata"]["chapter"] is None for item in questions
                ),
            },
        },
        "questions": questions,
    }
    output_path = output_path.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Review JSON: {output_path.relative_to(ROOT)} ({len(questions)} questions)")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, default=ROOT / "tmp/formal-test-review/report.json")
    parser.add_argument("--apply-tags", action="store_true", help="Apply only verified existing-question official_exam tags from the report.")
    parser.add_argument("--review-json", type=Path, help="Write a non-importable enriched-shaped formal-test review JSON.")
    args = parser.parse_args()
    report_path = args.report.resolve()
    if args.review_json:
        raise SystemExit(export_review_json(report_path, args.review_json))
    raise SystemExit(apply_verified_tags(report_path) if args.apply_tags else run(report_path))

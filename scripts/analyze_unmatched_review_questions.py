#!/usr/bin/env python3
"""Search the local question bank and analyze unresolved review questions.

This program can update only the non-importable formal-test review JSON. It
does not write files below out/ and does not create enriched records.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import unicodedata
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
KEYS = ("A", "B", "C", "D")
STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "because", "by", "for", "from", "has",
    "in", "is", "it", "of", "on", "or", "that", "the", "to", "was", "were", "which", "with",
    "would", "who", "will", "when", "where", "whether", "what", "why", "yes", "no",
}


def normalize(value: str) -> str:
    """Canonical form for retrieval: comparison ignores punctuation variants."""
    value = unicodedata.normalize("NFKD", value).lower().replace("\u00a0", " ")
    value = value.replace("'", "").replace("’", "").replace("`", "").replace("´", "")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value)).strip()


def tokens(value: str) -> list[str]:
    words = [word for word in normalize(value).split() if len(word) > 2 and word not in STOPWORDS]
    return words + [f"{left}_{right}" for left, right in zip(words, words[1:])]


def question_text(question: str, choices: dict[str, str]) -> str:
    return question + " " + " ".join(choices[key] for key in KEYS)


def source_id(item: dict[str, Any]) -> str:
    provenance = item["formal_test_provenance"][0]
    return f"{provenance['source_file']}::{item['subject']}#{provenance['source_question_number']}"


def existing_questions() -> dict[str, list[dict[str, Any]]]:
    by_subject: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for path in sorted(OUT.rglob("*_enriched.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        records = document.get("questions", document) if isinstance(document, dict) else document
        for item in records:
            choices = {key.upper(): str(value) for key, value in item.get("choices", {}).items()}
            if set(choices) != set(KEYS):
                continue
            by_subject[str(item["subject"])].append({
                "id": f"{path.relative_to(ROOT)}#{item['index']}",
                "chapter": str(item["chapter"]),
                "question": str(item["question"]),
                "choices": choices,
                "answer": str(item["answer"]).upper(),
            })
    return by_subject


def answer_mapping(source: dict[str, Any], candidate: dict[str, Any]) -> tuple[str | None, float]:
    source_answer = normalize(source["choices"][source["answer"]])
    score, letter = max(
        (SequenceMatcher(None, source_answer, normalize(candidate["choices"][key])).ratio(), key)
        for key in KEYS
    )
    return (letter, round(score, 6)) if score >= 0.90 else (None, round(score, 6))


def fuzzy_score(source: dict[str, Any], candidate: dict[str, Any]) -> float:
    stem = SequenceMatcher(None, normalize(source["question"]), normalize(candidate["question"])).ratio()
    choice_text = "|".join(normalize(source["choices"][key]) for key in KEYS)
    candidate_choices = "|".join(normalize(candidate["choices"][key]) for key in KEYS)
    choices = SequenceMatcher(None, choice_text, candidate_choices).ratio()
    return round(0.70 * stem + 0.30 * choices, 6)


def fuzzy_rank(source: dict[str, Any], records: list[dict[str, Any]], limit: int = 3) -> list[tuple[float, dict[str, Any]]]:
    """Use token overlap only as retrieval, then score a small candidate set exactly."""
    source_tokens = set(tokens(question_text(source["question"], source["choices"])))
    retrieved: list[tuple[float, dict[str, Any]]] = []
    for record in records:
        record_tokens = set(tokens(question_text(record["question"], record["choices"])))
        overlap = len(source_tokens & record_tokens) / max(1, min(len(source_tokens), len(record_tokens)))
        if overlap >= 0.12:
            retrieved.append((overlap, record))
    candidates = sorted(retrieved, key=lambda item: item[0], reverse=True)[:20]
    return sorted(
        ((fuzzy_score(source, record), record) for _, record in candidates),
        key=lambda result: result[0], reverse=True,
    )[:limit]


class Bm25:
    def __init__(self, records: list[dict[str, Any]]) -> None:
        self.records = records
        self.documents = [Counter(tokens(question_text(item["question"], item["choices"]))) for item in records]
        self.lengths = [sum(document.values()) for document in self.documents]
        self.average_length = sum(self.lengths) / max(1, len(self.lengths))
        self.document_frequency: Counter[str] = Counter()
        self.postings: dict[str, list[tuple[int, int]]] = defaultdict(list)
        for index, document in enumerate(self.documents):
            self.document_frequency.update(document.keys())
            for term, frequency in document.items():
                self.postings[term].append((index, frequency))

    def rank(self, source: dict[str, Any], limit: int = 3) -> list[tuple[float, dict[str, Any]]]:
        terms = Counter(tokens(question_text(source["question"], source["choices"])))
        total = len(self.records)
        totals: Counter[int] = Counter()
        for term, source_frequency in terms.items():
            inverse_frequency = math.log(1 + (total - self.document_frequency[term] + 0.5) / (self.document_frequency[term] + 0.5))
            for index, frequency in self.postings.get(term, []):
                denominator = frequency + 1.5 * (1 - 0.75 + 0.75 * self.lengths[index] / self.average_length)
                totals[index] += inverse_frequency * frequency * 2.5 / denominator * min(source_frequency, 2)
        scored = [(round(score, 6), self.records[index]) for index, score in totals.items()]
        return sorted(scored, key=lambda item: item[0], reverse=True)[:limit]


def candidate_json(score: float, record: dict[str, Any], answer: tuple[str | None, float] | None = None) -> dict[str, Any]:
    result = {"score": score, "enriched": record["id"], "chapter": record["chapter"]}
    if answer is not None:
        result["source_answer_maps_to"] = answer[0]
        result["answer_choice_similarity"] = answer[1]
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--review-json", type=Path, default=ROOT / "formal test/official_questions_review.json")
    parser.add_argument("--apply-review", action="store_true")
    args = parser.parse_args()
    review_path = args.review_json.resolve()
    if ROOT / "out" in review_path.parents or review_path.name.endswith("_enriched.json"):
        raise RuntimeError("Refusing an enriched JSON path.")
    review = json.loads(review_path.read_text(encoding="utf-8"))
    if review.get("meta", {}).get("importable") is not False:
        raise RuntimeError("Only non-importable review JSON can be analyzed.")

    corpus = existing_questions()
    engines = {subject: Bm25(records) for subject, records in corpus.items()}
    checked = near_matches = analyzed = 0
    for item in review["questions"]:
        if item["review"]["status"] not in {"no_existing_match", "answer_conflict"} or item["chapter"]:
            continue
        subject_records = corpus[item["subject"]]
        ranked_fuzzy = fuzzy_rank(item, subject_records)
        ranked_bm25 = engines[item["subject"]].rank(item)
        if ranked_fuzzy:
            top_fuzzy_score, top_fuzzy = ranked_fuzzy[0]
            mapped = answer_mapping(item, top_fuzzy)
            second_score = ranked_fuzzy[1][0] if len(ranked_fuzzy) > 1 else 0.0
            is_near_match = (
                top_fuzzy_score >= 0.82
                and top_fuzzy_score - second_score >= 0.02
                and mapped[0] == top_fuzzy["answer"]
                and bool(ranked_bm25)
                and top_fuzzy["chapter"] == ranked_bm25[0][1]["chapter"]
            )
        else:
            top_fuzzy = None
            is_near_match = False
        analysis = {
            "method": "local_fuzzy_and_bm25_search",
            "source_id": source_id(item),
            "fuzzy_candidates": [candidate_json(score, record, answer_mapping(item, record)) for score, record in ranked_fuzzy],
            "bm25_candidates": [candidate_json(score, record) for score, record in ranked_bm25],
            "candidate_chapter": ranked_bm25[0][1]["chapter"] if ranked_bm25 else None,
            "candidate_subject": item["subject"],
            "confidence": "high" if is_near_match else "review_required",
        }
        item["review"]["local_search"] = analysis
        if is_near_match:
            item["chapter"] = top_fuzzy["chapter"]
            item["review"]["chapter"] = top_fuzzy["chapter"]
            item["review"]["chapter_source"] = "near_existing_match"
            item["review"]["status"] = "near_existing_match"
            near_matches += 1
        else:
            analyzed += 1
        checked += 1

    review["meta"]["local_search_audit"] = {
        "method": "fuzzy similarity plus agreeing BM25 retrieval",
        "unmatched_without_chapter_checked": checked,
        "near_existing_matches_with_chapter_applied": near_matches,
        "chapter_analyses_requiring_review": analyzed,
    }
    if args.apply_review:
        temporary = review_path.with_suffix(review_path.suffix + ".tmp")
        temporary.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        json.loads(temporary.read_text(encoding="utf-8"))
        os.replace(temporary, review_path)
        print(f"Updated review JSON: {review_path.relative_to(ROOT)}")
    print(f"Checked: {checked}; near matches: {near_matches}; analyzed: {analyzed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

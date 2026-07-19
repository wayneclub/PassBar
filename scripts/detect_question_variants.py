#!/usr/bin/env python3
"""Find probable wording/order variants without treating topic similarity as a match."""
from __future__ import annotations

import argparse
import itertools
import json
from difflib import SequenceMatcher
from pathlib import Path

import analyze_unmatched_review_questions as search


ROOT = Path(__file__).resolve().parent.parent
KEYS = "ABCD"


def ratio(left: str, right: str) -> float:
    return SequenceMatcher(None, search.normalize(left), search.normalize(right)).ratio()


def source_id(item: dict) -> str:
    provenance = item["formal_test_provenance"][0]
    return f"{provenance['source_file']}::{item['subject']}#{provenance['source_question_number']}"


def compare(source: dict, candidate: dict) -> dict:
    matrix = [[ratio(source["choices"][a], candidate["choices"][b]) for b in KEYS] for a in KEYS]
    permutation = max(itertools.permutations(range(4)), key=lambda p: sum(matrix[i][p[i]] for i in range(4)))
    similarities = [matrix[i][permutation[i]] for i in range(4)]
    source_answer_index = KEYS.index(source["answer"])
    mapped_answer = KEYS[permutation[source_answer_index]]
    answer_similarity = similarities[source_answer_index]
    stem_similarity = ratio(source["question"], candidate["question"])
    choices_mean = sum(similarities) / 4
    choices_min = min(similarities)
    answer_matches = mapped_answer == candidate["answer"] and answer_similarity >= 0.80
    score = 0.55 * stem_similarity + 0.45 * choices_mean
    return {
        "score": round(score, 6),
        "stem_similarity": round(stem_similarity, 6),
        "choices_mean_similarity": round(choices_mean, 6),
        "choices_min_similarity": round(choices_min, 6),
        "answer_choice_similarity": round(answer_similarity, 6),
        "answer_matches": answer_matches,
        "choice_mapping": {KEYS[index]: KEYS[permutation[index]] for index in range(4)},
    }


def is_probable_variant(result: dict) -> bool:
    if not result["answer_matches"]:
        return False
    # Either the stem and choices both remain close, or all choices are near
    # verbatim while the stem has been moderately paraphrased.
    return (
        result["stem_similarity"] >= 0.68
        and result["choices_mean_similarity"] >= 0.84
        and result["choices_min_similarity"] >= 0.45
    ) or (
        result["stem_similarity"] >= 0.60
        and result["choices_mean_similarity"] >= 0.96
        and result["choices_min_similarity"] >= 0.90
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--review-json", type=Path, default=ROOT / "formal test/official_questions_review.json")
    parser.add_argument("--match-results", type=Path, default=ROOT / "formal test/match_test_results.json")
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/formal-test-review/additional-variant-candidates.json")
    args = parser.parse_args()

    review = json.loads(args.review_json.resolve().read_text(encoding="utf-8"))["questions"]
    match_results = json.loads(args.match_results.resolve().read_text(encoding="utf-8"))["results"]
    unmatched_indices = {row["review_index"] for row in match_results if row["result"] == "no_existing_match"}
    corpus = search.existing_questions()
    records = []
    for item in review:
        if item["index"] not in unmatched_indices:
            continue
        # Retrieval only narrows the search. Final acceptance below still uses
        # the full stem, every choice, answer-content mapping, and permutations.
        shortlist = [candidate for _, candidate in search.fuzzy_rank(item, corpus[item["subject"]], limit=25)]
        best = None
        best_candidate = None
        for candidate in shortlist:
            result = compare(item, candidate)
            if best is None or result["score"] > best["score"]:
                best, best_candidate = result, candidate
        if best and is_probable_variant(best):
            records.append({
                "review_index": item["index"],
                "source_id": source_id(item),
                "subject": item["subject"],
                "source_answer": item["answer"],
                "candidate": best_candidate["id"],
                "candidate_chapter": best_candidate["chapter"],
                "candidate_answer": best_candidate["answer"],
                **best,
            })
    records.sort(key=lambda row: (-row["score"], row["review_index"]))
    output = {
        "method": "subject-constrained exhaustive stem-and-all-choice comparison",
        "unmatched_questions_checked": len(unmatched_indices),
        "probable_variants": len(records),
        "records": records,
    }
    output_path = args.output.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Report: {output_path.relative_to(ROOT)}")
    print(f"Checked: {len(unmatched_indices)}; probable variants: {len(records)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Classify blank formal-test chapters from the existing subject-specific bank."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import analyze_unmatched_review_questions as search


ROOT = Path(__file__).resolve().parent.parent


def source_id(item: dict) -> str:
    provenance = item["formal_test_provenance"][0]
    return f"{provenance['source_file']}::{item['subject']}#{provenance['source_question_number']}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--review-json", type=Path, default=ROOT / "formal test/official_questions_review.json")
    parser.add_argument("--two-pass", type=Path, default=ROOT / "tmp/formal-test-review/chapter-classification-all.json")
    parser.add_argument("--output", type=Path, default=ROOT / "tmp/formal-test-review/chapter-classification-local.json")
    args = parser.parse_args()

    review = json.loads(args.review_json.resolve().read_text(encoding="utf-8"))
    prior = json.loads(args.two_pass.resolve().read_text(encoding="utf-8"))
    prior_by_id = {decision["source"]["id"]: decision for decision in prior["decisions"]}
    corpus = search.existing_questions()
    engines = {subject: search.Bm25(records) for subject, records in corpus.items()}
    decisions = []

    for item in review["questions"]:
        if str(item.get("chapter") or "").strip():
            continue
        item_id = source_id(item)
        prior_decision = prior_by_id.get(item_id)
        if prior_decision and prior_decision["action"] == "candidate_add":
            decisions.append({
                **prior_decision,
                "method": "gemini_two_pass_subject_constrained",
                "confidence": "high",
            })
            continue

        subject_records = corpus[item["subject"]]
        bm25 = engines[item["subject"]].rank(item, limit=3)
        fuzzy = search.fuzzy_rank(item, subject_records, limit=3)
        if not bm25:
            raise RuntimeError(f"No local chapter candidates for {item_id}")
        bm25_score, bm25_item = bm25[0]
        fuzzy_score, fuzzy_item = fuzzy[0] if fuzzy else (None, None)
        agreed = fuzzy_item is not None and fuzzy_item["chapter"] == bm25_item["chapter"]
        decisions.append({
            "source": {"id": item_id},
            "action": "candidate_add",
            "chapter": bm25_item["chapter"],
            "method": "subject_constrained_bm25_and_fuzzy_retrieval",
            "confidence": "high" if agreed else "medium",
            "pass_a": search.candidate_json(bm25_score, bm25_item),
            "pass_b": search.candidate_json(fuzzy_score, fuzzy_item) if fuzzy_item else None,
        })

    output = {
        "schema": "passbar.formal-test.chapter-classification.v2",
        "records": len(decisions),
        "candidate_additions": len(decisions),
        "high_confidence": sum(d["confidence"] == "high" for d in decisions),
        "medium_confidence": sum(d["confidence"] == "medium" for d in decisions),
        "decisions": decisions,
    }
    output_path = args.output.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Report: {output_path.relative_to(ROOT)}")
    print(json.dumps({key: output[key] for key in ("records", "high_confidence", "medium_confidence")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

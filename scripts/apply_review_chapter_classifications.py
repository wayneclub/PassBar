#!/usr/bin/env python3
"""Apply audited chapter classifications to the non-importable review JSON only."""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def source_id(item: dict) -> str:
    provenance = item["formal_test_provenance"][0]
    return (
        f"{provenance['source_file']}::{item['subject']}"
        f"#{provenance['source_question_number']}"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--review-json", type=Path, default=ROOT / "formal test/official_questions_review.json")
    parser.add_argument("--classifications", type=Path, required=True)
    args = parser.parse_args()

    review_path = args.review_json.resolve()
    if ROOT / "out" in review_path.parents or review_path.name.endswith("_enriched.json"):
        raise RuntimeError("Refusing to write an enriched JSON file.")
    review = json.loads(review_path.read_text(encoding="utf-8"))
    if review.get("meta", {}).get("importable") is not False:
        raise RuntimeError("Refusing to write an importable review document.")

    classifications = json.loads(args.classifications.resolve().read_text(encoding="utf-8"))
    decisions = {item["source"]["id"]: item for item in classifications["decisions"]}
    accepted = 0
    needs_review = 0
    for item in review["questions"]:
        decision = decisions.get(source_id(item))
        if decision is None:
            continue
        if item["chapter"]:
            raise RuntimeError(f"Refusing to replace a verified chapter: {source_id(item)}")
        classification = {
            "method": decision.get("method", "two_pass_independent_classification"),
            "confidence": decision.get("confidence"),
            "action": decision["action"],
            "pass_a": decision["pass_a"],
            "pass_b": decision["pass_b"],
        }
        item["review"]["classification"] = classification
        if decision["action"] == "candidate_add":
            item["chapter"] = decision["chapter"]
            item["review"]["chapter"] = decision["chapter"]
            item["review"]["chapter_source"] = classification["method"]
            item["review"]["status"] = "chapter_classified"
            accepted += 1
        else:
            needs_review += 1

    review["meta"]["chapter_classification"] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "input": str(args.classifications.resolve().relative_to(ROOT)),
        "candidate_chapters_applied": accepted,
        "still_needs_review": needs_review,
    }
    temporary = review_path.with_suffix(review_path.suffix + ".tmp")
    temporary.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    json.loads(temporary.read_text(encoding="utf-8"))
    os.replace(temporary, review_path)
    print(f"Updated review JSON: {review_path.relative_to(ROOT)}")
    print(f"Chapters applied: {accepted}; still needs review: {needs_review}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

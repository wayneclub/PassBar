#!/usr/bin/env python3
"""Export an auditable match-status view from the non-importable review JSON."""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


STATUS_LABELS = {
    "strict_match": "嚴格匹配",
    "variant_match": "同題變體匹配",
    "near_match_not_importable": "近似匹配",
    "no_existing_match": "未匹配",
    "answer_conflict": "答案衝突",
}


def percent(value: float | None) -> str:
    """Return a compact percentage for CSV review, leaving absent values blank."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value if value.endswith("%") else f"{float(value) * 100:.2f}%"
    return f"{value * 100:.2f}%"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--review-json", type=Path, default=ROOT / "formal test/official_questions_review.json")
    parser.add_argument("--output", type=Path, default=ROOT / "formal test/match_test_results.json")
    parser.add_argument("--csv-output", type=Path, default=ROOT / "formal test/match_test_results.csv")
    args = parser.parse_args()

    review = json.loads(args.review_json.resolve().read_text(encoding="utf-8"))
    rows = []
    review_by_index = {}
    for item in review["questions"]:
        review_by_index[item["index"]] = item
        decision = item["review"]
        provenance = item["formal_test_provenance"][0]
        status = decision["status"]
        if status == "matched_existing":
            bucket = "strict_match"
        elif status == "matched_existing_variant":
            bucket = "variant_match"
        elif status == "near_existing_match":
            bucket = "near_match_not_importable"
        elif status == "answer_conflict":
            bucket = "answer_conflict"
        else:
            bucket = "no_existing_match"
        rows.append({
            "review_index": item["index"],
            "result": bucket,
            "subject": item["subject"],
            "chapter": item["chapter"] or None,
            "source_file": provenance["source_file"],
            "source_question_number": provenance["source_question_number"],
            "existing_question": decision.get("existing_question"),
            "match_score": decision.get("match_score"),
            "answer_verified": decision.get("answer_verified"),
            "nearest_candidate": decision.get("nearest_candidate"),
        })
    rows.sort(key=lambda item: (item["result"], item["source_file"], item["source_question_number"]))
    output = {
        "schema": "passbar.formal-test.match-test.v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "strict_match_rule": "same subject, weighted stem-and-choice similarity >= 0.90, and official answer text maps to the existing answer option",
        "summary": dict(sorted(Counter(item["result"] for item in rows).items())),
        "results": rows,
    }
    output_path = args.output.resolve()
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    csv_path = args.csv_output.resolve()
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "review_index",
        "status",
        "status_zh",
        "subject",
        "chapter",
        "source_file",
        "source_format",
        "source_question_number",
        "official_answer",
        "official_question",
        "choice_a",
        "choice_b",
        "choice_c",
        "choice_d",
        "existing_question",
        "nearest_candidate",
        "nearest_candidate_chapter",
        "nearest_candidate_answer",
        "similarity_percent",
        "source_answer_maps_to_candidate",
        "answer_choice_similarity_percent",
        "answer_verified",
    ]
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            item = review_by_index[row["review_index"]]
            candidate = row["nearest_candidate"] or {}
            score = row["match_score"]
            if score is None:
                score = candidate.get("score")
            writer.writerow({
                "review_index": row["review_index"],
                "status": row["result"],
                "status_zh": STATUS_LABELS[row["result"]],
                "subject": row["subject"] or "",
                "chapter": row["chapter"] or "",
                "source_file": row["source_file"],
                "source_format": item["source_document"]["format"],
                "source_question_number": row["source_question_number"],
                "official_answer": item["answer"],
                "official_question": item["question"],
                "choice_a": item["choices"].get("A", ""),
                "choice_b": item["choices"].get("B", ""),
                "choice_c": item["choices"].get("C", ""),
                "choice_d": item["choices"].get("D", ""),
                "existing_question": row["existing_question"] or "",
                "nearest_candidate": candidate.get("enriched", ""),
                "nearest_candidate_chapter": candidate.get("chapter", ""),
                "nearest_candidate_answer": candidate.get("answer", ""),
                "similarity_percent": percent(score),
                "source_answer_maps_to_candidate": candidate.get("source_answer_maps_to", ""),
                "answer_choice_similarity_percent": percent(candidate.get("answer_choice_similarity")),
                "answer_verified": "" if row["answer_verified"] is None else str(row["answer_verified"]).lower(),
            })
    print(f"Match test: {output_path.relative_to(ROOT)}")
    print(f"CSV review: {csv_path.relative_to(ROOT)}")
    print(json.dumps(output["summary"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

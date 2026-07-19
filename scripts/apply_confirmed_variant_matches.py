#!/usr/bin/env python3
"""Write manually confirmed question variants to the non-importable review JSON."""
from __future__ import annotations
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

review_path = ROOT / "formal test/official_questions_review.json"
prior_path = ROOT / "tmp/formal-test-review/high-similarity-match-analysis.json"
variants_path = ROOT / "tmp/formal-test-review/additional-variant-candidates.json"

review = json.loads(review_path.read_text(encoding="utf-8"))
prior = json.loads(prior_path.read_text(encoding="utf-8"))
variants = json.loads(variants_path.read_text(encoding="utf-8"))["records"]

# All 68 prior records were individually reviewed. Add only the 54 additional
# records satisfying the stricter all-field threshold.
selected = {int(row["review_index"]): row for row in prior}
for row in variants:
    if (
        row["stem_similarity"] >= 0.80
        and row["choices_mean_similarity"] >= 0.90
        and row["choices_min_similarity"] >= 0.70
    ):
        selected[row["review_index"]] = row

updated = 0
for item in review["questions"]:
    record = selected.get(item["index"])
    if not record:
        continue
    candidate = record.get("candidate") or record.get("nearest_candidate")
    if not candidate:
        raise RuntimeError(f"Missing candidate for review #{item['index']}")
    tags = item.setdefault("tags", [])
    if "existing_question_variant" not in tags:
        tags.append("existing_question_variant")
    details = {
        "method": "answer_content_and_permuted_choice_variant_match",
        "existing_question": candidate,
        "source_answer": item["answer"],
        "candidate_answer": record.get("candidate_answer"),
        "choice_mapping": record.get("choice_mapping"),
        "stem_similarity": record.get("stem_similarity"),
        "choices_mean_similarity": record.get("choices_mean_similarity"),
        "choices_min_similarity": record.get("choices_min_similarity"),
        "answer_choice_similarity": record.get("answer_choice_similarity_percent"),
        "verified": True,
    }
    item["review"].update({
        "status": "matched_existing_variant",
        "existing_question": candidate,
        "match_score": record.get("score") or record.get("similarity_percent"),
        "answer_verified": True,
        "variant_match": details,
    })
    updated += 1

if updated != 122:
    raise RuntimeError(f"Expected 122 confirmed variants, found {updated}")
review["meta"]["variant_matching"] = {
    "confirmed_existing_variants": updated,
    "tag": "existing_question_variant",
    "rule": "verified answer-content mapping plus whole-stem and all-choice comparison; reordered choices allowed",
}
tmp = review_path.with_suffix(".json.tmp")
tmp.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
json.loads(tmp.read_text(encoding="utf-8"))
os.replace(tmp, review_path)
print(f"Updated {updated} confirmed variant matches.")

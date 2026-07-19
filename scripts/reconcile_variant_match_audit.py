#!/usr/bin/env python3
"""Remove variant matches that fail answer-content audit."""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
path = ROOT / "formal test/official_questions_review.json"
review = json.loads(path.read_text(encoding="utf-8"))
item = next(question for question in review["questions"] if question["index"] == 626)
item["tags"] = [tag for tag in item.get("tags", []) if tag != "existing_question_variant"]
for key in ("existing_question", "match_score", "variant_match"):
    item["review"].pop(key, None)
item["review"]["status"] = "chapter_classified"
item["review"]["answer_verified"] = False
item["review"]["variant_match_audit"] = {
    "result": "rejected",
    "reason": "official source answer D does not map to the existing question's correct C option content",
}
review["meta"]["variant_matching"]["confirmed_existing_variants"] = 121
tmp = path.with_suffix(".json.tmp")
tmp.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
json.loads(tmp.read_text(encoding="utf-8"))
os.replace(tmp, path)
print("Rejected variant #626; retained as chapter-classified unmatched question.")

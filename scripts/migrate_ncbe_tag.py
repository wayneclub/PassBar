#!/usr/bin/env python3
"""Replace the legacy official_exam classification tag with ncbe.

Only question tags are changed. Provenance source_type remains official_exam,
which describes the kind of NCBE source rather than the learner-facing label.
"""
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TARGETS = (ROOT / "out", ROOT / "formal test" / "official_questions_review.json")


def update_question(question: dict) -> bool:
    tags = question.get("tags")
    if not isinstance(tags, list) or "official_exam" not in tags:
        return False
    question["tags"] = ["ncbe" if tag == "official_exam" else tag for tag in tags]
    return True


def update_file(path: Path) -> tuple[int, bool]:
    document = json.loads(path.read_text(encoding="utf-8"))
    questions = document.get("questions", []) if isinstance(document, dict) else []
    changed = sum(update_question(question) for question in questions if isinstance(question, dict))
    if changed:
        path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return changed, bool(changed)


def main() -> int:
    files = sorted((ROOT / "out").rglob("*_enriched.json")) + [TARGETS[1]]
    changed_questions = changed_files = 0
    for path in files:
        count, changed = update_file(path)
        changed_questions += count
        changed_files += changed
    print(json.dumps({"questions": changed_questions, "files": changed_files}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

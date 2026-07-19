#!/usr/bin/env python3
"""Normalize review chapter labels to the exact chapter names in enriched JSON."""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"


def normalized(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def main() -> int:
    review_path = ROOT / "formal test/official_questions_review.json"
    review = json.loads(review_path.read_text(encoding="utf-8"))
    chapters: dict[str, dict[str, str]] = {}
    for path in OUT.rglob("*_enriched.json"):
        meta = json.loads(path.read_text(encoding="utf-8"))["meta"]
        subject = meta["subject"]
        key = normalized(meta["chapter"])
        if key in chapters.setdefault(subject, {}) and chapters[subject][key] != meta["chapter"]:
            raise RuntimeError(f"Ambiguous normalized chapter name for {subject}: {key}")
        chapters[subject][key] = meta["chapter"]
    changes = []
    for item in review["questions"]:
        chapter = str(item.get("chapter") or "")
        canonical = chapters.get(item.get("subject"), {}).get(normalized(chapter))
        if canonical and canonical != chapter:
            changes.append({"review_index": item["index"], "from": chapter, "to": canonical})
            item["chapter"] = canonical
            item.setdefault("review", {})["chapter"] = canonical
            import_review = item["review"].get("chapter_import_review")
            if isinstance(import_review, dict):
                import_review["assigned_chapter"] = canonical
    review.setdefault("meta", {})["chapter_label_normalization"] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "method": "case-and-punctuation-insensitive match to enriched chapter metadata",
        "changes": changes,
    }
    tmp = review_path.with_suffix(review_path.suffix + ".chapter-normalize.tmp")
    tmp.write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    json.loads(tmp.read_text(encoding="utf-8"))
    os.replace(tmp, review_path)
    print(json.dumps({"changes": len(changes), "records": changes}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

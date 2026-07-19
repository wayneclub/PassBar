#!/usr/bin/env python3
"""Create a non-production enriched-bank staging tree for approved official questions.

Only records explicitly marked ``approved_for_staging`` by the independent
chapter review are copied in.  The production ``out/`` tree is never modified;
the caller must validate the staging tree before promoting it.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"


def slug(value: str) -> str:
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", value.lower().replace("&", "and")))


def target_path(root: Path, subject: str, chapter: str) -> Path:
    return root / subject / chapter / f"{subject}_{chapter}_enriched.json"


def source_uid(item: dict[str, Any], entry: dict[str, Any]) -> str:
    return ":".join((
        "official",
        str(entry["source_type"]),
        str(entry["source_sha256"]),
        str(item["subject"]),
        str(entry["source_question_number"]),
    ))


def provenance(item: dict[str, Any], entry: dict[str, Any]) -> dict[str, Any]:
    document = item["source_document"]
    return {
        "source_uid": source_uid(item, entry),
        "provider": "ncbe",
        "source_type": "official_exam",
        "source_file": entry["source_file"],
        "format": document["format"],
        "source_question_number": entry["source_question_number"],
        "source_sha256": entry["source_sha256"],
        "answer_key": item["answer"],
    }


def summarize_sources(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    files: dict[tuple[str, str], set[str]] = defaultdict(set)
    for item in items:
        for entry in item.get("provenance", []):
            provider = str(entry.get("provider") or "unknown")
            source_type = str(entry.get("source_type") or "unknown")
            key = (provider, source_type)
            grouped.setdefault(key, {"provider": provider, "source_type": source_type, "question_count": 0})
            grouped[key]["question_count"] += 1
            if entry.get("source_file"):
                files[key].add(str(entry["source_file"]))
    result = []
    for key in sorted(grouped):
        record = grouped[key]
        if files[key]:
            record["source_files"] = sorted(files[key])
        result.append(record)
    return result


def validate_record(record: dict[str, Any], path: Path) -> None:
    if not record["question"].strip():
        raise RuntimeError(f"{path}: missing question text")
    if set(record["choices"]) != {"A", "B", "C", "D"} or not all(record["choices"].values()):
        raise RuntimeError(f"{path}: choices must be complete A-D")
    if record["answer"] not in record["choices"]:
        raise RuntimeError(f"{path}: answer is not a valid choice")
    if not record["chapter"] or not record["subject"] or not record["question_uid"]:
        raise RuntimeError(f"{path}: missing import identity")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--review-json", type=Path, default=ROOT / "formal test/official_questions_review.json")
    parser.add_argument("--staging-out", type=Path, default=ROOT / "tmp/formal-test-staging/out")
    parser.add_argument("--report", type=Path, default=ROOT / "tmp/formal-test-staging/report.json")
    args = parser.parse_args()
    staging_out = args.staging_out.resolve()
    if staging_out.exists():
        raise RuntimeError(f"Staging output already exists: {staging_out}; inspect it rather than overwriting it")
    review = json.loads(args.review_json.resolve().read_text(encoding="utf-8"))
    candidates = [
        item for item in review["questions"]
        if item.get("review", {}).get("chapter_import_review", {}).get("status") == "approved_for_staging"
    ]
    if not candidates:
        raise RuntimeError("No approved records found for staging")
    if any(not item.get("chapter") for item in candidates):
        raise RuntimeError("Approved staging candidate lacks a chapter")

    shutil.copytree(OUT, staging_out, ignore=shutil.ignore_patterns("*.bak", "*.tmp", ".DS_Store"))
    additions: dict[Path, list[dict[str, Any]]] = defaultdict(list)
    all_uids: set[str] = set()
    for item in candidates:
        source_entries = item.get("formal_test_provenance", [])
        if len(source_entries) != 1:
            raise RuntimeError(f"Review #{item['index']} must have exactly one source provenance record")
        entry = source_entries[0]
        uid = source_uid(item, entry)
        if uid in all_uids:
            raise RuntimeError(f"Duplicate official staging source UID: {uid}")
        all_uids.add(uid)
        destination = target_path(staging_out, item["subject"], item["chapter"])
        additions[destination].append({
            "question_uid": uid,
            "subject": item["subject"],
            "chapter": item["chapter"],
            "topic": item.get("topic"),
            "question": item["question"],
            "choices": item["choices"],
            "answer": item["answer"],
            "tags": ["ncbe"],
            "provenance": [provenance(item, entry)],
            "source_img": "",
            "explanation": "",
            "zh-question": "",
            "zh-choices": {},
            "zh-explanation": "",
            "import_review": {
                "status": "approved_for_staging",
                "classification": item["review"]["chapter_import_review"],
            },
        })

    staged_summary = []
    for path, records in sorted(additions.items()):
        if not path.exists():
            raise RuntimeError(f"Missing canonical chapter target: {path}")
        document = json.loads(path.read_text(encoding="utf-8"))
        items = document["questions"]
        existing_uids = {item.get("question_uid") for item in items}
        next_index = max(item["index"] for item in items) + 1
        for record in records:
            if record["question_uid"] in existing_uids:
                raise RuntimeError(f"Duplicate staging UID already in enriched bank: {record['question_uid']}")
            record["index"] = next_index
            next_index += 1
            validate_record(record, path)
            items.append(record)
        for item in items:
            item["count"] = len(items)
        document["meta"]["count"] = len(items)
        document["meta"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
        document["meta"]["sources"] = summarize_sources(items)
        path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        staged_summary.append({
            "file": str(path.relative_to(staging_out)),
            "added": len(records),
            "total": len(items),
        })

    manual_review = [
        item for item in review["questions"]
        if item.get("review", {}).get("chapter_import_review", {}).get("status")
        == "manual_review_required"
    ]
    report = {
        "schema": "passbar.formal-test.staging.v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "production_out": str(OUT.relative_to(ROOT)),
        "staging_out": str(staging_out.relative_to(ROOT)),
        "approved_candidates_added": len(candidates),
        "manual_review_not_imported": len(manual_review),
        "chapters_changed": staged_summary,
    }
    args.report.resolve().parent.mkdir(parents=True, exist_ok=True)
    args.report.resolve().write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "approved_candidates_added": report["approved_candidates_added"],
        "manual_review_not_imported": report["manual_review_not_imported"],
        "chapters_changed": len(staged_summary),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

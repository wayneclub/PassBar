#!/usr/bin/env python3
"""Promote a validated formal-test staging tree into the canonical ``out/`` bank.

This intentionally accepts only files listed in a staging report.  Before any
write it proves that every existing question remains present and unchanged
(apart from its derived ``count`` field), and that each additional question is
an NCBE record with immutable provenance.  ``--write`` is required to mutate
the canonical bank.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"


@dataclass
class Promotion:
    relative_path: Path
    source: Path
    destination: Path
    additions: int
    total: int


def read_document(path: Path) -> dict[str, Any]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict) or not isinstance(document.get("questions"), list):
        raise RuntimeError(f"Invalid enriched JSON shape: {path}")
    return document


def question_by_uid(document: dict[str, Any], path: Path) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for item in document["questions"]:
        uid = item.get("question_uid")
        if not isinstance(uid, str) or not uid:
            raise RuntimeError(f"{path}: question missing question_uid")
        if uid in result:
            raise RuntimeError(f"{path}: duplicate question_uid {uid}")
        result[uid] = item
    return result


def without_derived_count(item: dict[str, Any]) -> dict[str, Any]:
    value = copy.deepcopy(item)
    value.pop("count", None)
    return value


def validate_question_counts(document: dict[str, Any], path: Path) -> None:
    questions = document["questions"]
    count = len(questions)
    if document.get("meta", {}).get("count") != count:
        raise RuntimeError(f"{path}: meta count does not equal question count")
    if "count" in document and document["count"] != count:
        raise RuntimeError(f"{path}: root count does not equal question count")
    if any(item.get("count") != count for item in questions):
        raise RuntimeError(f"{path}: question count metadata does not equal question count")


def validate_addition(item: dict[str, Any], path: Path) -> None:
    tags = item.get("tags")
    provenance = item.get("provenance")
    if not isinstance(tags, list) or "ncbe" not in tags:
        raise RuntimeError(f"{path}: staged addition is not tagged ncbe")
    if not isinstance(provenance, list) or not provenance:
        raise RuntimeError(f"{path}: staged addition lacks provenance")
    if not any(
        isinstance(entry, dict)
        and entry.get("provider") == "ncbe"
        and entry.get("source_uid")
        for entry in provenance
    ):
        raise RuntimeError(f"{path}: staged addition lacks NCBE source UID")
    uid = item.get("question_uid")
    if not isinstance(uid, str) or not uid.startswith("official:"):
        raise RuntimeError(f"{path}: staged addition does not have an official question UID")
    choices = item.get("choices")
    if not isinstance(choices, dict) or set(choices) != {"A", "B", "C", "D"}:
        raise RuntimeError(f"{path}: staged addition must have choices A-D")
    if item.get("answer") not in choices:
        raise RuntimeError(f"{path}: staged addition answer is invalid")


def build_promotions(report: dict[str, Any], staging_out: Path) -> list[Promotion]:
    changes = report.get("chapters_changed")
    if report.get("schema") != "passbar.formal-test.staging.v1" or not isinstance(changes, list):
        raise RuntimeError("Invalid formal-test staging report")
    promotions: list[Promotion] = []
    for change in changes:
        relative_path = Path(change["file"])
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise RuntimeError(f"Unsafe staging path: {relative_path}")
        source = (staging_out / relative_path).resolve()
        destination = (OUT / relative_path).resolve()
        if OUT not in destination.parents or staging_out not in source.parents:
            raise RuntimeError(f"Refusing path outside staging/out: {relative_path}")
        if not source.is_file() or not destination.is_file():
            raise RuntimeError(f"Missing staging or canonical chapter file: {relative_path}")
        promotions.append(Promotion(
            relative_path=relative_path,
            source=source,
            destination=destination,
            additions=int(change["added"]),
            total=int(change["total"]),
        ))
    if not promotions:
        raise RuntimeError("Staging report has no changed chapters")
    return promotions


def validate_promotion(promotion: Promotion) -> None:
    production = read_document(promotion.destination)
    staged = read_document(promotion.source)
    validate_question_counts(staged, promotion.source)
    production_by_uid = question_by_uid(production, promotion.destination)
    staged_by_uid = question_by_uid(staged, promotion.source)
    removed = set(production_by_uid) - set(staged_by_uid)
    if removed:
        raise RuntimeError(f"{promotion.relative_path}: staging would remove {len(removed)} existing questions")
    additions = set(staged_by_uid) - set(production_by_uid)
    if len(additions) != promotion.additions:
        raise RuntimeError(
            f"{promotion.relative_path}: expected {promotion.additions} additions, found {len(additions)}"
        )
    if len(staged_by_uid) != promotion.total:
        raise RuntimeError(f"{promotion.relative_path}: report total does not match staged question count")
    for uid, production_item in production_by_uid.items():
        if without_derived_count(production_item) != without_derived_count(staged_by_uid[uid]):
            raise RuntimeError(f"{promotion.relative_path}: existing question changed: {uid}")
    for uid in additions:
        validate_addition(staged_by_uid[uid], promotion.source)


def atomic_write(destination: Path, document: dict[str, Any], stamp: str) -> None:
    backup = destination.with_suffix(destination.suffix + f".formal-promotion-{stamp}.bak")
    if not backup.exists():
        backup.write_text(destination.read_text(encoding="utf-8"), encoding="utf-8")
    temporary = destination.with_suffix(destination.suffix + ".formal-promotion.tmp")
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    json.loads(temporary.read_text(encoding="utf-8"))
    os.replace(temporary, destination)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--staging-out", type=Path, required=True)
    parser.add_argument("--staging-report", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    staging_out = args.staging_out.resolve()
    report = json.loads(args.staging_report.resolve().read_text(encoding="utf-8"))
    promotions = build_promotions(report, staging_out)
    for promotion in promotions:
        validate_promotion(promotion)

    summary = {
        "schema": "passbar.formal-test.promotion.v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "write" if args.write else "dry_run",
        "chapters_changed": len(promotions),
        "questions_added": sum(p.additions for p in promotions),
        "questions_removed": 0,
        "chapters": [
            {"file": str(p.relative_path), "added": p.additions, "total": p.total}
            for p in promotions
        ],
    }
    if args.write:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        for promotion in promotions:
            atomic_write(promotion.destination, read_document(promotion.source), stamp)
    args.report.resolve().parent.mkdir(parents=True, exist_ok=True)
    args.report.resolve().write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "mode": summary["mode"],
        "chapters_changed": summary["chapters_changed"],
        "questions_added": summary["questions_added"],
        "questions_removed": summary["questions_removed"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

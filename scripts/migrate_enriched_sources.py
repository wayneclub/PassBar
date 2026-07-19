#!/usr/bin/env python3
"""Backfill stable UWorld provenance and maintain multi-source enriched metadata.

This is intentionally an in-place migration for existing enriched records only.
It does not add formal-test questions, alter stems/choices/answers, or remove
any provenance.  Future builders use ``question_uid`` rather than a raw-source
numeric index to avoid UWorld/new-source index collisions.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"


def slug(value: Any) -> str:
    value = str(value).lower().replace("&", "and")
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", value))


def uworld_uid(subject: str, chapter: str, source_index: int) -> str:
    return f"uworld:{slug(subject)}:{slug(chapter)}:{source_index}"


def atomic_write(path: Path, document: dict[str, Any], stamp: str) -> None:
    backup = path.with_suffix(path.suffix + f".source-migration-{stamp}.bak")
    if not backup.exists():
        backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    temporary = path.with_suffix(path.suffix + ".source-migration.tmp")
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    json.loads(temporary.read_text(encoding="utf-8"))
    os.replace(temporary, path)


def source_summary(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Summarize actual question provenance for a chapter document."""
    entries: dict[tuple[str, str], dict[str, Any]] = {}
    source_files: dict[tuple[str, str], set[str]] = defaultdict(set)
    uids: dict[tuple[str, str], set[str]] = defaultdict(set)
    for item in items:
        for provenance in item.get("provenance", []):
            if not isinstance(provenance, dict):
                continue
            provider = str(provenance.get("provider") or "unknown")
            source_type = str(provenance.get("source_type") or "unknown")
            key = (provider, source_type)
            entry = entries.setdefault(key, {
                "provider": provider,
                "source_type": source_type,
                "question_count": 0,
            })
            entry["question_count"] += 1
            if provenance.get("source_file"):
                source_files[key].add(str(provenance["source_file"]))
            if provenance.get("source_uid"):
                uids[key].add(str(provenance["source_uid"]))
    result = []
    for key in sorted(entries):
        entry = entries[key]
        if source_files[key]:
            entry["source_files"] = sorted(source_files[key])
        entry["source_record_count"] = len(uids[key])
        result.append(entry)
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    parser.add_argument(
        "--report", type=Path,
        default=ROOT / "tmp/formal-test-review/enriched-source-migration.json",
    )
    args = parser.parse_args()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    seen_question_uids: dict[str, str] = {}
    stats = defaultdict(int)
    changed_files: list[str] = []

    for path in sorted(OUT.rglob("*_enriched.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        meta = document.get("meta")
        items = document.get("questions")
        if not isinstance(meta, dict) or not isinstance(items, list):
            raise RuntimeError(f"Expected enriched document object at {path}")
        subject = str(meta.get("subject") or "")
        chapter = str(meta.get("chapter") or "")
        raw_source = str(meta.get("sourceQuestionsFile") or "")
        if not subject or not chapter or not raw_source:
            raise RuntimeError(f"{path}: missing subject, chapter, or sourceQuestionsFile")

        changed = False
        for item in items:
            source_index = item.get("index")
            if not isinstance(source_index, int) or source_index < 1:
                raise RuntimeError(f"{path}: invalid existing question index {source_index!r}")
            expected_uid = uworld_uid(subject, chapter, source_index)
            uid = item.get("question_uid")
            if uid is None:
                item["question_uid"] = expected_uid
                uid = expected_uid
                stats["question_uids_added"] += 1
                changed = True
            elif not isinstance(uid, str) or not uid:
                raise RuntimeError(f"{path} #{source_index}: invalid question_uid")
            if uid in seen_question_uids:
                raise RuntimeError(f"Duplicate question_uid {uid}: {seen_question_uids[uid]} and {path}#{source_index}")
            seen_question_uids[uid] = f"{path.relative_to(ROOT)}#{source_index}"

            provenance = item.get("provenance", [])
            if not isinstance(provenance, list):
                raise RuntimeError(f"{path} #{source_index}: provenance must be a list")
            if not any(isinstance(entry, dict) and entry.get("provider") == "uworld" for entry in provenance):
                provenance.append({
                    "source_uid": expected_uid,
                    "provider": "uworld",
                    "source_type": "question_bank",
                    "source_file": raw_source,
                    "source_question_index": source_index,
                })
                item["provenance"] = provenance
                stats["uworld_provenance_added"] += 1
                changed = True

        desired_sources = source_summary(items)
        if meta.get("count") != len(items):
            meta["count"] = len(items)
            stats["meta_counts_corrected"] += 1
            changed = True
        if meta.get("sources") != desired_sources:
            meta["sources"] = desired_sources
            stats["meta_source_summaries_added_or_updated"] += 1
            changed = True
        if changed:
            meta["updatedAt"] = datetime.now(timezone.utc).isoformat()
            changed_files.append(str(path.relative_to(ROOT)))
            if args.write:
                atomic_write(path, document, stamp)

    report = {
        "schema": "passbar.enriched-source-migration.v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "write" if args.write else "dry_run",
        "files_changed": changed_files,
        "question_uid_count": len(seen_question_uids),
        "stats": dict(stats),
    }
    args.report.resolve().parent.mkdir(parents=True, exist_ok=True)
    args.report.resolve().write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"mode": report["mode"], "files_changed": len(changed_files), **dict(stats)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

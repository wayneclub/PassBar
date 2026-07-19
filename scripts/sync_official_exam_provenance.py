#!/usr/bin/env python3
"""Synchronize confirmed formal-test tags and provenance into enriched JSON.

This script never creates questions.  It only updates existing enriched records
that the review file has already tied to an existing question.  It also
migrates the legacy Chinese ``真題`` tag to ``official_exam`` as explicitly
approved by the product owner, while reporting legacy tags that have no
machine-verifiable formal-test provenance.
"""
from __future__ import annotations

import argparse
import json
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
REVIEW = ROOT / "formal test/official_questions_review.json"
CONFIRMED = {"matched_existing", "matched_existing_variant"}


def source_uid(item: dict[str, Any], entry: dict[str, Any]) -> str:
    """Stable identity for one question in one immutable source document."""
    return ":".join((
        "official",
        str(entry.get("source_type") or item["source_document"].get("source_type") or "unknown"),
        str(entry.get("source_sha256") or "unknown"),
        str(item["subject"]),
        str(entry["source_question_number"]),
    ))


def official_provenance(item: dict[str, Any], entry: dict[str, Any]) -> dict[str, Any]:
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


def load_confirmed_targets(review: dict[str, Any]) -> dict[Path, dict[int, list[dict[str, Any]]]]:
    targets: dict[Path, dict[int, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for item in review["questions"]:
        decision = item.get("review", {})
        if decision.get("status") not in CONFIRMED:
            continue
        existing = decision.get("existing_question")
        if not isinstance(existing, str) or "#" not in existing:
            raise RuntimeError(f"Confirmed review item #{item['index']} has no existing question target")
        relative_path, raw_index = existing.rsplit("#", 1)
        try:
            target_path = (ROOT / relative_path).resolve()
            target_index = int(raw_index)
        except ValueError as exc:
            raise RuntimeError(f"Invalid existing target {existing!r}") from exc
        if OUT not in target_path.parents:
            raise RuntimeError(f"Refusing target outside out/: {existing}")
        for entry in item.get("formal_test_provenance", []):
            targets[target_path][target_index].append({
                "provenance": official_provenance(item, entry),
                "variant": decision.get("status") == "matched_existing_variant",
            })
    return targets


def normalized_tags(tags: Any) -> tuple[list[str], bool]:
    if tags is None:
        return [], False
    if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
        raise RuntimeError("tags must be a list of strings")
    had_legacy = "真題" in tags
    result = [tag for tag in tags if tag != "真題"]
    if had_legacy and "official_exam" not in result:
        result.append("official_exam")
    return sorted(set(result)), had_legacy


def atomic_write(path: Path, document: dict[str, Any], backup_suffix: str) -> None:
    backup = path.with_suffix(path.suffix + backup_suffix)
    if not backup.exists():
        backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    temporary = path.with_suffix(path.suffix + ".official-sync.tmp")
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    json.loads(temporary.read_text(encoding="utf-8"))
    os.replace(temporary, path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--review-json", type=Path, default=REVIEW)
    parser.add_argument(
        "--report", type=Path,
        default=ROOT / "tmp/formal-test-review/official-tag-provenance-sync.json",
    )
    parser.add_argument("--write", action="store_true", help="Write enriched JSON after a clean audit")
    args = parser.parse_args()

    review = json.loads(args.review_json.resolve().read_text(encoding="utf-8"))
    if review.get("meta", {}).get("importable") is not False:
        raise RuntimeError("Expected the non-importable formal-test review JSON")
    targets = load_confirmed_targets(review)
    if not targets:
        raise RuntimeError("No confirmed existing-question targets found")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    stats = defaultdict(int)
    legacy_without_verified_provenance: list[dict[str, Any]] = []
    missing_targets: list[str] = []
    changed_files = 0

    for path in sorted(OUT.rglob("*_enriched.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        items = document.get("questions")
        if not isinstance(items, list):
            raise RuntimeError(f"Invalid enriched JSON shape: {path}")
        targets_by_index = targets.get(path.resolve(), {})
        indexes = {item.get("index") for item in items}
        for index in targets_by_index:
            if index not in indexes:
                missing_targets.append(f"{path.relative_to(ROOT)}#{index}")

        changed = False
        for item in items:
            index = item.get("index")
            tags, had_legacy = normalized_tags(item.get("tags", []))
            target_entries = targets_by_index.get(index, [])
            has_verified_official_source = bool(target_entries) or any(
                isinstance(entry, dict) and entry.get("source_type") == "official_exam"
                for entry in item.get("provenance", [])
            )

            if had_legacy:
                stats["legacy_chinese_tags_migrated"] += 1
                if not has_verified_official_source:
                    legacy_without_verified_provenance.append({
                        "enriched": f"{path.relative_to(ROOT)}#{index}",
                        "reason": "legacy 真題 tag had no confirmed review match or official provenance",
                    })
            if target_entries and "official_exam" not in tags:
                tags.append("official_exam")
                stats["confirmed_targets_tagged"] += 1
            if any(entry["variant"] for entry in target_entries) and "existing_question_variant" not in tags:
                tags.append("existing_question_variant")
                stats["confirmed_variants_tagged"] += 1
            tags = sorted(set(tags))
            if tags != item.get("tags", []):
                item["tags"] = tags
                changed = True

            provenance = item.get("provenance", [])
            if not isinstance(provenance, list):
                raise RuntimeError(f"{path} #{index}: provenance must be a list")
            seen = {entry.get("source_uid") for entry in provenance if isinstance(entry, dict)}
            for target in target_entries:
                entry = target["provenance"]
                if entry["source_uid"] not in seen:
                    provenance.append(entry)
                    seen.add(entry["source_uid"])
                    stats["official_provenance_added"] += 1
                    changed = True
            if provenance != item.get("provenance", []):
                item["provenance"] = provenance

        if changed:
            changed_files += 1
            if args.write:
                atomic_write(path, document, f".official-sync-{stamp}.bak")

    report = {
        "schema": "passbar.official-exam-sync.v1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "write" if args.write else "dry_run",
        "confirmed_review_targets": sum(len(indexes) for indexes in targets.values()),
        "changed_files": changed_files,
        "stats": dict(stats),
        "missing_targets": missing_targets,
        "legacy_tag_without_verified_provenance": legacy_without_verified_provenance,
    }
    args.report.resolve().parent.mkdir(parents=True, exist_ok=True)
    args.report.resolve().write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "mode": report["mode"],
        "confirmed_review_targets": report["confirmed_review_targets"],
        "changed_files": changed_files,
        **dict(stats),
        "missing_targets": len(missing_targets),
        "legacy_without_verified_provenance": len(legacy_without_verified_provenance),
    }, ensure_ascii=False))
    if missing_targets:
        raise RuntimeError("Refusing successful completion with missing existing-question targets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

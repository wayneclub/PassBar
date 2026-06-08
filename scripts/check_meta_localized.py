#!/usr/bin/env python3
"""
check_meta_localized.py

掃描所有 *_enriched.json，找出 meta.question_analysis 裡 label / reason
不符合 { "en": "...", "zh": "..." } 雙語結構的題目。

檢查範圍：
  - question_keyword_meta.keywords[]
  - choice_keyword_meta.choices.{A,B,C,D}[]
  - question_highlight_meta.highlights[]

輸出：
  - 終端機摘要
  - meta_localized_report.json
  - meta_localized_report.csv

使用方式：
  python3 scripts/check_meta_localized.py
  python3 scripts/check_meta_localized.py --subject "Evidence"
  python3 scripts/check_meta_localized.py --enriched-file out/Evidence/Hearsay/Hearsay_castudy_enriched.json
  python3 scripts/check_meta_localized.py --clear
  python3 scripts/check_meta_localized.py --clear --dry-run

--clear 會遞迴掃描 out/ 內所有 *_enriched.json，
只刪除題目中 label/reason 不符合 {en, zh} 的 question.meta，
題目本體欄位（index、question、choices、explanation、zh-* 等）一律保留，
不會修改 castudy.json、report.json 等其他 JSON。
"""

from __future__ import annotations

import argparse
import csv
import glob
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


OUT_DIR = os.environ.get(
    "OUT_DIR",
    os.path.join(os.path.dirname(__file__), "..", "out"),
)

# 只處理 enriched 題庫檔；不碰 castudy.json、report.json 等其他 JSON
ENRICHED_JSON_PATTERN = re.compile(r".*_enriched\.json$", re.IGNORECASE)

# --clear 時絕對不可刪除或改寫的題目欄位（僅允許移除 meta）
PROTECTED_QUESTION_KEYS = frozenset({
    "index",
    "subject",
    "chapter",
    "topic",
    "count",
    "question",
    "choices",
    "answer",
    "source_img",
    "explanation",
    "zh-question",
    "zh-choices",
    "zh-explanation",
    "explain_imgs",
})


def load_enriched_document(path: str) -> tuple[Any, list[dict[str, Any]]]:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data, [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict) and isinstance(data.get("questions"), list):
        return data, [item for item in data["questions"] if isinstance(item, dict)]
    raise ValueError(f"Unsupported enriched JSON shape: {path}")


def load_enriched_questions(path: str) -> list[dict[str, Any]]:
    _, questions = load_enriched_document(path)
    return questions


def save_enriched_document(path: str, document: Any) -> None:
    assert_enriched_json_path(path)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(document, f, ensure_ascii=False, indent=2)
        f.write("\n")


def needs_meta_regeneration(q: dict[str, Any]) -> bool:
    return check_question(q)["needs_regeneration"]


def clear_question_meta_only(q: dict[str, Any]) -> bool:
    """Remove only question.meta. Returns True if meta was removed."""
    if "meta" not in q:
        return False

    snapshot = {key: q[key] for key in q if key != "meta"}
    q.pop("meta", None)

    for key, value in snapshot.items():
        if q.get(key) != value:
            raise RuntimeError(
                f"Refusing to save: clearing meta altered protected field '{key}' "
                f"on question index={q.get('index', '?')}"
            )

    removed_only_meta = set(snapshot.keys()) == set(q.keys())
    if not removed_only_meta:
        extra = set(q.keys()) - set(snapshot.keys())
        raise RuntimeError(
            f"Refusing to save: unexpected keys after meta clear on "
            f"question index={q.get('index', '?')}: {sorted(extra)}"
        )

    return True


def clear_invalid_meta_in_file(path: str, *, dry_run: bool = False) -> tuple[int, int]:
    """Remove question-level meta for items needing regeneration. Returns (cleared, total)."""
    assert_enriched_json_path(path)
    document, questions = load_enriched_document(path)
    cleared = 0

    for q in questions:
        if not needs_meta_regeneration(q):
            continue
        if "meta" not in q:
            continue
        if dry_run:
            cleared += 1
            continue
        if clear_question_meta_only(q):
            cleared += 1

    if cleared and not dry_run:
        save_enriched_document(path, document)

    return cleared, len(questions)


def is_enriched_json_path(path: str) -> bool:
    return bool(ENRICHED_JSON_PATTERN.match(os.path.basename(path)))


def assert_enriched_json_path(path: str) -> None:
    if not is_enriched_json_path(path):
        raise ValueError(f"Refusing to modify non-enriched JSON: {path}")


def subject_chapter_from_path(path: str, out_dir: str) -> tuple[str, str]:
    rel = os.path.relpath(path, out_dir)
    parts = Path(rel).parts
    if len(parts) >= 3:
        return parts[0], parts[1]
    if len(parts) >= 2:
        return parts[0], ""
    return "", ""


def discover_enriched_files(
    out_dir: str,
    *,
    subject: str = "",
    chapter: str = "",
    enriched_file: str = "",
) -> list[str]:
    """Recursively find all *_enriched.json under out/. Never returns other JSON types."""
    if enriched_file:
        path = os.path.abspath(enriched_file)
        if not os.path.isfile(path):
            print(f"ERROR: enriched file not found: {path}")
            sys.exit(1)
        if not is_enriched_json_path(path):
            print(f"ERROR: not an enriched JSON file: {path}")
            sys.exit(1)
        return [path]

    paths = sorted(
        p for p in glob.glob(os.path.join(out_dir, "**", "*_enriched.json"), recursive=True)
        if os.path.isfile(p) and is_enriched_json_path(p)
    )

    if subject:
        subject_lower = subject.lower()
        paths = [p for p in paths if subject_lower in p.lower()]
    if chapter:
        chapter_lower = chapter.lower()
        paths = [p for p in paths if chapter_lower in p.lower()]

    return paths


def localized_issue(value: Any) -> str | None:
    """Return issue code when value is not valid {en, zh} with non-empty strings."""
    if not isinstance(value, dict):
        return "not_object"

    en = value.get("en")
    zh = value.get("zh")

    if not isinstance(en, str) or not en.strip():
        return "missing_or_empty_en"
    if not isinstance(zh, str) or not zh.strip():
        return "missing_or_empty_zh"

    extra_keys = sorted(set(value.keys()) - {"en", "zh"})
    if extra_keys:
        return f"extra_keys:{','.join(extra_keys)}"

    return None


def check_localized_field(
    container: dict[str, Any],
    field: str,
    *,
    section: str,
    item_id: str,
) -> list[dict[str, str]]:
    issue = localized_issue(container.get(field))
    if not issue:
        return []

    value = container.get(field)
    preview = ""
    if isinstance(value, str):
        preview = value[:120]
    elif isinstance(value, dict):
        preview = json.dumps(value, ensure_ascii=False)[:120]
    else:
        preview = str(value)[:120]

    return [{
        "section": section,
        "item_id": item_id,
        "field": field,
        "issue": issue,
        "value_preview": preview,
    }]


def check_meta_items(qa: dict[str, Any]) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []

    keywords = (qa.get("question_keyword_meta") or {}).get("keywords") or []
    if isinstance(keywords, list):
        for idx, item in enumerate(keywords):
            if not isinstance(item, dict):
                continue
            item_id = str(item.get("id") or f"keyword[{idx}]")
            for field in ("label", "reason"):
                issues.extend(
                    check_localized_field(
                        item,
                        field,
                        section="question_keyword_meta",
                        item_id=item_id,
                    )
                )

    choices = (qa.get("choice_keyword_meta") or {}).get("choices") or {}
    if isinstance(choices, dict):
        for letter, items in choices.items():
            if not isinstance(items, list):
                continue
            for idx, item in enumerate(items):
                if not isinstance(item, dict):
                    continue
                item_id = str(item.get("id") or f"{letter}[{idx}]")
                section = f"choice_keyword_meta.{letter}"
                for field in ("label", "reason"):
                    issues.extend(
                        check_localized_field(
                            item,
                            field,
                            section=section,
                            item_id=item_id,
                        )
                    )

    highlights = (qa.get("question_highlight_meta") or {}).get("highlights") or []
    if isinstance(highlights, list):
        for idx, item in enumerate(highlights):
            if not isinstance(item, dict):
                continue
            item_id = str(item.get("id") or f"highlight[{idx}]")
            for field in ("label", "reason"):
                issues.extend(
                    check_localized_field(
                        item,
                        field,
                        section="question_highlight_meta",
                        item_id=item_id,
                    )
                )

    return issues


def check_question(q: dict[str, Any]) -> dict[str, Any]:
    meta = q.get("meta")
    qa = meta.get("question_analysis") if isinstance(meta, dict) else None

    if not qa:
        return {
            "needs_regeneration": False,
            "missing_question_analysis": True,
            "issues": [],
        }

    issues = check_meta_items(qa)
    return {
        "needs_regeneration": bool(issues),
        "missing_question_analysis": False,
        "issues": issues,
    }


def collect_enriched_files(
    out_dir: str,
    *,
    subject: str = "",
    chapter: str = "",
    enriched_file: str = "",
) -> list[tuple[str, str, str]]:
    """Return (subject, chapter, enriched_path) tuples for every *_enriched.json under out/."""
    return [
        (*subject_chapter_from_path(path, out_dir), path)
        for path in discover_enriched_files(
            out_dir,
            subject=subject,
            chapter=chapter,
            enriched_file=enriched_file,
        )
    ]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Find enriched questions whose meta label/reason lack {en, zh} structure",
    )
    parser.add_argument("--out-dir", default=OUT_DIR, help="Path to out/ directory")
    parser.add_argument("--subject", default="", help="Filter by subject name (partial match)")
    parser.add_argument("--chapter", default="", help="Filter by chapter name (partial match)")
    parser.add_argument(
        "--enriched-file",
        default="",
        help="Scan a single enriched JSON file instead of all chapters",
    )
    parser.add_argument(
        "--report-dir",
        default="",
        help="Directory to write report files (default: out/ root)",
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Remove question meta for items needing regeneration",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="With --clear, show what would be removed without writing files",
    )
    args = parser.parse_args()

    out_dir = os.path.abspath(args.out_dir)
    if not args.enriched_file and not os.path.isdir(out_dir):
        print(f"ERROR: out directory not found: {out_dir}")
        sys.exit(1)

    report_dir = os.path.abspath(args.report_dir) if args.report_dir else out_dir
    selections = collect_enriched_files(
        out_dir,
        subject=args.subject,
        chapter=args.chapter,
        enriched_file=args.enriched_file,
    )

    if not selections:
        print("No enriched files found.")
        sys.exit(0)

    if args.clear:
        total_cleared = 0
        total_questions = 0
        files_changed = 0
        files_scanned = len(selections)

        print(f"\n{'=' * 72}")
        print("  Enriched JSON — 清除不完整 meta")
        print(f"  掃描 out/ 內所有 *_enriched.json（共 {files_scanned} 個）")
        print("  只刪除題目的 meta.question_analysis，保留 question / choices / explanation 等欄位")
        print("  不碰 castudy / report 等其他 JSON")
        if args.dry_run:
            print("  (dry-run: 不寫入檔案)")
        print(f"{'=' * 72}\n")

        for subject, chapter, enriched_path in selections:
            try:
                cleared, ch_total = clear_invalid_meta_in_file(
                    enriched_path,
                    dry_run=args.dry_run,
                )
            except Exception as exc:
                print(f"  WARN: cannot process {enriched_path}: {exc}")
                continue

            total_cleared += cleared
            total_questions += ch_total
            if cleared:
                files_changed += 1
                rel = os.path.relpath(enriched_path, out_dir)
                action = "would clear" if args.dry_run else "cleared"
                label = f"{subject} / {chapter}" if subject else rel
                print(f"  {label}: {action} meta on {cleared}/{ch_total}  ({rel})")

        print()
        action = "Would clear" if args.dry_run else "Cleared"
        print(
            f"  {action} meta on {total_cleared}/{total_questions} question(s) "
            f"across {files_changed}/{files_scanned} enriched file(s)."
        )
        print()
        return

    total_questions = 0
    total_needs_regen = 0
    total_missing_qa = 0
    chapter_stats: list[dict[str, Any]] = []
    bad_records: list[dict[str, Any]] = []

    for subject, chapter, enriched_path in selections:
        try:
            questions = load_enriched_questions(enriched_path)
        except Exception as exc:
            print(f"  WARN: cannot read {enriched_path}: {exc}")
            continue

        ch_total = len(questions)
        ch_needs_regen = 0
        ch_missing_qa = 0
        ch_issue_counts: dict[str, int] = {}

        for q in questions:
            total_questions += 1
            result = check_question(q)
            if result["missing_question_analysis"]:
                ch_missing_qa += 1
                total_missing_qa += 1
                bad_records.append({
                    "subject": subject,
                    "chapter": chapter,
                    "index": q.get("index", "?"),
                    "question_preview": str(q.get("question", ""))[:80],
                    "missing_question_analysis": True,
                    "issue_count": 0,
                    "sections": "",
                    "issues_json": "[]",
                    "enriched_file": os.path.relpath(enriched_path, out_dir),
                })
                continue

            if not result["needs_regeneration"]:
                continue

            ch_needs_regen += 1
            total_needs_regen += 1
            issues = result["issues"]
            for issue in issues:
                key = f"{issue['section']}.{issue['field']}.{issue['issue']}"
                ch_issue_counts[key] = ch_issue_counts.get(key, 0) + 1

            sections = sorted({issue["section"] for issue in issues})
            bad_records.append({
                "subject": subject,
                "chapter": chapter,
                "index": q.get("index", "?"),
                "question_preview": str(q.get("question", ""))[:80],
                "missing_question_analysis": False,
                "issue_count": len(issues),
                "sections": ", ".join(sections),
                "issues_json": json.dumps(issues, ensure_ascii=False),
                "enriched_file": os.path.relpath(enriched_path, out_dir),
            })

        chapter_stats.append({
            "subject": subject,
            "chapter": chapter,
            "total": ch_total,
            "needs_regeneration": ch_needs_regen,
            "missing_question_analysis": ch_missing_qa,
            "enriched_file": os.path.relpath(enriched_path, out_dir),
            "issue_counts": ch_issue_counts,
        })

    pct = (
        f"{total_needs_regen / total_questions * 100:.1f}%"
        if total_questions
        else "N/A"
    )

    print(f"\n{'=' * 72}")
    print("  Enriched JSON — meta label/reason 雙語結構檢查")
    print(f"{'=' * 72}")
    print(f"  掃描章節數         : {len(selections)}")
    print(f"  總題目數           : {total_questions}")
    print(f"  需重新生成 meta    : {total_needs_regen}  ({pct})")
    print(f"  缺 question_analysis: {total_missing_qa}")
    print()

    current_subject = None
    for cs in chapter_stats:
        if cs["subject"] != current_subject:
            current_subject = cs["subject"]
            print(f"  📚 {current_subject}")

        bad = cs["needs_regeneration"] + cs["missing_question_analysis"]
        if bad == 0:
            status = "✅"
        elif bad == cs["total"]:
            status = "❌"
        else:
            status = "⚠️ "

        print(
            f"     {status} {cs['chapter']:<45} "
            f"{bad:>3}/{cs['total']:>3}  "
            f"[regen:{cs['needs_regeneration']} "
            f"no_qa:{cs['missing_question_analysis']}]"
        )

    print()

    os.makedirs(report_dir, exist_ok=True)

    json_path = os.path.join(report_dir, "meta_localized_report.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "summary": {
                    "total_chapters": len(selections),
                    "total_questions": total_questions,
                    "needs_regeneration": total_needs_regen,
                    "missing_question_analysis": total_missing_qa,
                },
                "chapter_stats": chapter_stats,
                "questions_needing_regeneration": bad_records,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
    print(f"  📄 JSON report → {json_path}")

    csv_path = os.path.join(report_dir, "meta_localized_report.csv")
    if bad_records:
        fieldnames = list(bad_records[0].keys())
        with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(bad_records)
        print(f"  📊 CSV  report → {csv_path}")
    else:
        print("  🎉 All meta label/reason fields are localized — no CSV written.")

    print()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Restore enriched zh-explanation HTML from original CAStudy htmlContent.

This intentionally avoids style normalization. It copies the original
apiResult.data[0].htmlContent from each chapter's *_castudy.json into the
matching *_castudy_enriched.json question's zh-explanation, after removing
footer/branding text such as "© MBE Study Aid | 仅供学习参考".

Usage:
  python3 scripts/restore_zh_explanation_from_castudy.py          # dry-run
  python3 scripts/restore_zh_explanation_from_castudy.py --apply  # write files
  python3 scripts/restore_zh_explanation_from_castudy.py --subject "Criminal Law"
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


OUT_DIR = Path(__file__).resolve().parent.parent / "out"

FOOTER_BLOCK_RE = re.compile(
    r"<(?P<tag>footer|div|p|small|span|section)[^>]*>"
    r"(?:(?!</(?P=tag)>).)*?"
    r"(?:"
    r"©\s*MBE"
    r"|MBE\s*Study\s*Aid"
    r"|MBE\s*备考助手"
    r"|MBE\s*備考助手"
    r"|MBE\s*备考"
    r"|MBE\s*備考"
    r"|仅供学习参考"
    r"|僅供學習參考"
    r"|仅供参考"
    r"|僅供參考"
    r")"
    r"(?:(?!</(?P=tag)>).)*?</(?P=tag)>",
    re.IGNORECASE | re.DOTALL,
)

FOOTER_TEXT_RE = re.compile(
    r"(?:"
    r"©\s*MBE(?:\s*Study\s*Aid)?"
    r"|MBE\s*Study\s*Aid"
    r"|MBE\s*备考助手"
    r"|MBE\s*備考助手"
    r"|MBE\s*备考"
    r"|MBE\s*備考"
    r")"
    r"[^<\n\r]*(?:仅供学习参考|僅供學習參考|仅供参考|僅供參考)?",
    re.IGNORECASE,
)


def normalize_question_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def strip_footer(html: str) -> str:
    if not html:
        return html

    previous = None
    while previous != html:
        previous = html
        html = FOOTER_BLOCK_RE.sub("", html)

    html = FOOTER_TEXT_RE.sub("", html)
    html = re.sub(r"\n{3,}", "\n\n", html)
    return html.strip()


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def get_questions(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("questions"), list):
        return data["questions"]
    return []


def get_html_content(source_question: dict[str, Any]) -> str:
    api = source_question.get("apiResult") or {}
    data = api.get("data")
    item: Any = None

    if isinstance(data, list) and data:
        item = data[0]
    elif isinstance(data, dict):
        nested = data.get("data")
        if isinstance(nested, list) and nested:
            item = nested[0]
        else:
            item = data

    if not isinstance(item, dict):
        return ""

    html = item.get("htmlContent") or ""
    return html if isinstance(html, str) else ""


def find_source_file(enriched_path: Path) -> Path | None:
    chapter_dir = enriched_path.parent
    candidates = [
        Path(path)
        for path in glob.glob(str(chapter_dir / "*_castudy.json"))
        if not path.endswith("_castudy_enriched.json")
        and not path.endswith(".failed.json")
    ]
    if not candidates:
        return None
    return sorted(candidates, key=lambda p: (p.stat().st_mtime, p.name), reverse=True)[0]


def process_file(enriched_path: Path, apply: bool) -> dict[str, Any]:
    source_path = find_source_file(enriched_path)
    if not source_path:
        return {"path": enriched_path, "error": "missing source *_castudy.json"}

    enriched_data = load_json(enriched_path)
    source_data = load_json(source_path)
    enriched_questions = get_questions(enriched_data)
    source_questions = get_questions(source_data)

    source_by_index = {q.get("index"): q for q in source_questions if q.get("index") is not None}
    source_by_question = {
        normalize_question_text(q.get("question", "")): q
        for q in source_questions
        if q.get("question")
    }

    changed = 0
    missing = 0
    stripped = 0

    for enriched_q in enriched_questions:
        source_q = source_by_index.get(enriched_q.get("index"))
        if source_q is None:
            source_q = source_by_question.get(normalize_question_text(enriched_q.get("question", "")))

        if source_q is None:
            missing += 1
            continue

        html = get_html_content(source_q)
        if not html.strip():
            missing += 1
            continue

        cleaned = strip_footer(html)
        if cleaned != html.strip():
            stripped += 1

        if enriched_q.get("zh-explanation") != cleaned:
            enriched_q["zh-explanation"] = cleaned
            changed += 1

    if changed and apply:
        with enriched_path.open("w", encoding="utf-8") as f:
            json.dump(enriched_data, f, ensure_ascii=False, indent=2)

    return {
        "path": enriched_path,
        "source": source_path,
        "questions": len(enriched_questions),
        "changed": changed,
        "missing": missing,
        "stripped": stripped,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Restore zh-explanation from CAStudy htmlContent")
    parser.add_argument("--apply", action="store_true", help="Write changes")
    parser.add_argument("--out-dir", default=str(OUT_DIR))
    parser.add_argument("--subject", default="", help="Filter by path")
    parser.add_argument("--chapter", default="", help="Filter by path")
    args = parser.parse_args()

    out_dir = Path(args.out_dir).resolve()
    if not out_dir.is_dir():
        print(f"ERROR: out dir not found: {out_dir}")
        sys.exit(1)

    files = sorted(out_dir.glob("*/*/*_castudy_enriched.json"))
    if args.subject:
        files = [p for p in files if args.subject.lower() in str(p).lower()]
    if args.chapter:
        files = [p for p in files if args.chapter.lower() in str(p).lower()]

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"\n{'=' * 72}")
    print(f"  restore_zh_explanation_from_castudy  [{mode}]")
    print(f"  Files: {len(files)}")
    print(f"{'=' * 72}\n")

    total_files = 0
    total_changed = 0
    total_missing = 0
    total_stripped = 0

    for path in files:
        result = process_file(path, apply=args.apply)
        rel = os.path.relpath(path, out_dir)
        if "error" in result:
            print(f"  ❌ {rel}: {result['error']}")
            continue
        if result["changed"]:
            total_files += 1
            total_changed += result["changed"]
            total_missing += result["missing"]
            total_stripped += result["stripped"]
            tag = "saved" if args.apply else "dry-run"
            print(
                f"  ✏️  {rel}: {result['changed']} q ({tag}), "
                f"footer stripped={result['stripped']}, missing={result['missing']}"
            )
        elif result["missing"]:
            total_missing += result["missing"]
            print(f"  ⚠️  {rel}: no changes, missing htmlContent={result['missing']}")

    print(f"\n{'=' * 72}")
    print(f"  Files changed     : {total_files}")
    print(f"  Questions restored: {total_changed}")
    print(f"  Footers stripped  : {total_stripped}")
    print(f"  Missing html      : {total_missing}")
    if not args.apply:
        print("\n  Dry-run only. Re-run with --apply to write.")
    else:
        print("\n  ✅ Done.")
    print()


if __name__ == "__main__":
    main()
